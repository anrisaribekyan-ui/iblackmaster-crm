"""Режим помощника: связь с CRM и выполнение задач.

Два потока:
- пульс (раз в 10 с): какие айфоны подключены, вошли ли в Apple ID → POST /agent/heartbeat;
- задачи (раз в 3 с): POST /agent/next → выполнить → отчёты POST /agent/jobs/{id}.

Пароль Apple ID живёт только в памяти, пока Apple не принял код (не дольше 15 минут).
"""

from __future__ import annotations

import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from . import config, device
from .ipatool import AppUnavailable, AuthRequired, Ipatool, IpatoolError
from .tunnel import APPLE_PROXY

log = logging.getLogger("station.agent")

HEARTBEAT_SEC = 10
POLL_SEC = 3
APPLE_RECHECK_SEC = 300
PENDING_LOGIN_TTL = 15 * 60


def _ssl_context() -> ssl.SSLContext:
    """Собранная программа (PyInstaller) на Mac не видит системные сертификаты — берём набор certifi."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover
        return ssl.create_default_context()


SSL_CONTEXT = _ssl_context()


class CrmError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Crm:
    def __init__(self, url: str, token: str):
        self.base = f"{url}/api/app-install/agent"
        self.token = token

    def post(self, path: str, body: Optional[dict] = None, timeout: int = 20) -> Any:
        data = json.dumps(body or {}).encode()
        req = urllib.request.Request(
            self.base + path,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "X-Station-Token": self.token,
                     "User-Agent": f"iBlackMasterStation/{config.VERSION}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read() or b"{}").get("message") or str(exc)
            except ValueError:
                message = str(exc)
            raise CrmError(exc.code, message) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise CrmError(0, f"CRM недоступна: {exc}") from exc
        return json.loads(raw) if raw else None

    def _headers(self) -> dict:
        return {"X-Station-Token": self.token, "User-Agent": f"iBlackMasterStation/{config.VERSION}"}

    def download_file(self, path: str, dest: Path, progress: Optional[Callable[[int], None]] = None) -> None:
        """Скачать файл из CRM (архив IPA) во временный файл и переименовать — без половинок."""
        tmp = dest.with_suffix(dest.suffix + ".part")
        req = urllib.request.Request(self.base + path, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT) as resp, tmp.open("wb") as out:
                total = int(resp.headers.get("Content-Length") or 0)
                done, last = 0, -1
                while chunk := resp.read(1024 * 1024):
                    out.write(chunk)
                    done += len(chunk)
                    if progress and total:
                        pct = done * 100 // total
                        if pct >= last + 5:
                            last = pct
                            progress(pct)
            tmp.replace(dest)
        except urllib.error.HTTPError as exc:
            tmp.unlink(missing_ok=True)
            raise CrmError(exc.code, f"Архив CRM: {exc}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            tmp.unlink(missing_ok=True)
            raise CrmError(0, f"Архив CRM недоступен: {exc}") from exc

    def upload_file(self, path: str, src: Path) -> Any:
        """Отправить файл в CRM телом запроса (без multipart), потоком."""
        size = src.stat().st_size
        with src.open("rb") as body:
            req = urllib.request.Request(self.base + path, data=body, method="POST",
                                         headers={**self._headers(), "Content-Type": "application/octet-stream",
                                                  "Content-Length": str(size)})
            try:
                with urllib.request.urlopen(req, timeout=600, context=SSL_CONTEXT) as resp:
                    raw = resp.read()
            except urllib.error.HTTPError as exc:
                try:
                    message = json.loads(exc.read() or b"{}").get("message") or str(exc)
                except ValueError:
                    message = str(exc)
                raise CrmError(exc.code, message) from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                raise CrmError(0, f"CRM недоступна: {exc}") from exc
        return json.loads(raw) if raw else None


class _Cancelled(Exception):
    """Задачу отменили в CRM — тихо выходим."""


@dataclass
class PendingLogin:
    email: str
    password: str
    since: float


class Agent:
    def __init__(self, settings: config.Settings):
        if not settings.crm_url or not settings.station_token:
            raise SystemExit("Станция не подключена к CRM. Выполните: station connect <код из CRM>")
        self.settings = settings
        self.crm = Crm(settings.crm_url, settings.station_token)
        self.ipatool = Ipatool(settings)
        self.stop = threading.Event()
        self.pending_logins: dict[int, PendingLogin] = {}
        self.apple_auth = "unknown"
        self.apple_id: Optional[str] = settings.apple_id_email or None
        self._apple_checked_at = 0.0
        self._lock = threading.Lock()

    def reload_token(self) -> bool:
        """CRM отказала в доступе: возможно, код подключения заменили (переустановка, «Переподключить»).
        Перечитываем config.json — новый код подхватится без перезапуска помощника."""
        fresh = config.load()
        if fresh.station_token and fresh.station_token != self.crm.token:
            self.crm = Crm(fresh.crm_url or self.settings.crm_url, fresh.station_token)
            log.info("Подхватил новый код подключения")
            return True
        return False

    # ------------------------------------------------------------- пульс

    def _check_apple(self, force: bool = False) -> None:
        if not force and time.monotonic() - self._apple_checked_at < APPLE_RECHECK_SEC:
            return
        self._apple_checked_at = time.monotonic()
        try:
            info = self.ipatool.info()
            self.apple_auth, self.apple_id = "ok", info.get("email") or self.apple_id
        except AuthRequired:
            self.apple_auth = "needed"
        except IpatoolError as exc:
            log.warning("ipatool auth info: %s", exc)
            self.apple_auth = "needed" if "not" in str(exc).lower() else "unknown"

    def heartbeat(self) -> None:
        try:
            devices = device.list_devices()
        except device.DeviceError as exc:
            log.warning("USB: %s", exc)
            devices = []
        self._check_apple()
        self.crm.post("/heartbeat", {
            "os": config.os_name(),
            "agent_version": config.VERSION,
            "devices": devices,
            "apple_id": self.apple_id,
            "apple_auth": self.apple_auth,
            "apple_route": APPLE_PROXY.describe(),
        })

    def _heartbeat_loop(self) -> None:
        failures = 0
        while not self.stop.is_set():
            try:
                self.heartbeat()
                if failures:
                    log.info("Связь с CRM восстановлена")
                failures = 0
            except CrmError as exc:
                failures += 1
                if exc.status == 401 and self.reload_token():
                    continue
                if exc.status == 401:
                    log.error("CRM не принимает токен станции: %s. Вставьте новый код подключения.", exc)
                elif failures in (1, 10) or failures % 60 == 0:
                    log.warning("Пульс не дошёл (%s раз): %s", failures, exc)
            except Exception:  # noqa: BLE001
                log.exception("Сбой пульса")
            self.stop.wait(HEARTBEAT_SEC)

    # ------------------------------------------------------------- задачи

    def report(self, job_id: int, **data: Any) -> bool:
        """Отправить отчёт. True — задачу отменили в CRM."""
        clean = {k: v for k, v in data.items() if v is not None}
        for attempt in range(3):
            try:
                result = self.crm.post(f"/jobs/{job_id}", clean) or {}
                return bool(result.get("cancelled"))
            except CrmError as exc:
                if exc.status in (400, 401, 404, 422) or attempt == 2:
                    log.warning("Отчёт по задаче %s не принят: %s", job_id, exc)
                    return False
                time.sleep(2 * (attempt + 1))
        return False

    def run_job(self, job: dict) -> None:
        kind, job_id = job["kind"], job["id"]
        log.info("Задача %s: %s", job_id, kind)
        try:
            if kind == "scan":
                self._scan(job)
            elif kind == "purchases":
                self._purchases(job)
            elif kind == "login":
                self._login(job)
            elif kind == "install":
                self._install(job)
            else:
                self.report(job_id, state="failed", message=f"Неизвестная задача: {kind}")
        except AuthRequired as exc:
            self.apple_auth = "needed"
            log.warning("Задача %s: нужен вход в Apple ID (%s)", job_id, exc)
            self.report(job_id, state="failed", error_code="AUTH_REQUIRED",
                        message="Нужен вход в Apple ID: нажмите «Войти» у станции и повторите")
        except AppUnavailable as exc:
            self.report(job_id, state="failed", error_code=exc.code, message=str(exc))
        except (IpatoolError, device.DeviceError) as exc:
            self.report(job_id, state="failed", error_code=exc.code, message=str(exc))
        except Exception as exc:  # noqa: BLE001
            log.exception("Задача %s упала", job_id)
            self.report(job_id, state="failed", error_code="AGENT_ERROR", message=f"Сбой помощника: {exc}")
        finally:
            self._send_heartbeat_soon()

    def _send_heartbeat_soon(self) -> None:
        try:
            self.heartbeat()
        except Exception:  # noqa: BLE001
            pass

    def _scan(self, job: dict) -> None:
        self.report(job["id"], message="Читаю приложения с телефона…")
        apps = device.scan_apps(job["target_udid"])
        store = [
            {"adam_id": a["adam_id"], "bundle_id": a["bundle_id"], "name": a["name"],
             "version": a["version"], "version_id": a["version_id"]}
            for a in apps if a["from_app_store"]
        ]
        other = len(apps) - len(store)
        tail = f", ещё {other} не из App Store" if other else ""
        self.report(job["id"], state="done", apps=store, message=f"Найдено приложений из App Store: {len(store)}{tail}")

    def _purchases(self, job: dict) -> None:
        self.report(job["id"], message="Загружаю покупки Apple ID…")
        collected: list[dict] = []
        page, total = 1, None
        while page <= 50:
            data = self.ipatool.purchases(page=page, limit=100)
            items = data.get("apps") or []
            total = data.get("totalCount", total)
            for a in items:
                if a.get("id"):
                    collected.append({"adam_id": int(a["id"]), "bundle_id": a.get("bundleID") or "",
                                      "name": a.get("name") or a.get("bundleID") or str(a["id"]),
                                      "version": a.get("version") or None})
            if not items or (total is not None and len(collected) >= int(total)):
                break
            page += 1
            self.report(job["id"], message=f"Загружено {len(collected)} из {total or '?'}…")
        self.apple_auth = "ok"
        self.report(job["id"], state="done", apps=collected, message=f"В покупках: {len(collected)}")

    def _login(self, job: dict) -> None:
        job_id, secret = job["id"], job.get("secret") or ""
        with self._lock:
            pending = self.pending_logins.get(job_id)
            if pending and time.monotonic() - pending.since > PENDING_LOGIN_TTL:
                self.pending_logins.pop(job_id, None)
                pending = None

        if pending is None and len(secret) == 6 and secret.isdigit():
            self.report(job_id, state="failed", message="Помощник перезапускался и забыл пароль. Начните вход заново.")
            return
        if pending is None:
            email = job.get("email") or ""
            if not email or not secret:
                self.report(job_id, state="failed", message="Нет Apple ID или пароля. Начните вход заново.")
                return
            try:
                self.ipatool.login(email, secret)
            except AuthRequired as exc:
                if "code" not in str(exc).lower():
                    self.report(job_id, state="failed", message=f"Apple не принял вход: {exc}")
                    return
                with self._lock:
                    self.pending_logins[job_id] = PendingLogin(email, secret, time.monotonic())
                self.report(job_id, state="need_code", message="Apple прислал код на ваш iPhone. Введите его здесь.")
                return
        else:
            code = "".join(ch for ch in secret if ch.isdigit())
            try:
                self.ipatool.login(pending.email, pending.password, code)
            except AuthRequired as exc:
                text = str(exc).lower()
                if "code" in text or "verification" in text:
                    self.report(job_id, state="need_code", message="Код не подошёл. Введите новый код от Apple.")
                    return
                with self._lock:
                    self.pending_logins.pop(job_id, None)
                self.report(job_id, state="failed", message=f"Apple не принял вход: {exc}")
                return
            with self._lock:
                self.pending_logins.pop(job_id, None)
            email = pending.email

        config.write_config({"apple_id_email": email})
        self.apple_auth, self.apple_id = "ok", email
        self._apple_checked_at = time.monotonic()
        self.report(job_id, state="done", apple_id=email, message=f"Вход выполнен: {email}")

    def _get_ipa(self, job: dict) -> tuple[Path, str]:
        """IPA для установки: локальный кэш → архив CRM → Apple. Возвращает (путь, откуда)."""
        job_id = job["id"]
        name = job.get("app_name") or "приложение"
        cached = self.ipatool.cached_path(job["adam_id"], job.get("version_id"))
        if cached.is_file() and cached.stat().st_size > 0:
            return cached, "кэша станции"

        if job.get("ipa_in_crm") and job.get("app_id"):
            mb = (job.get("ipa_size") or 0) / 1_048_576
            if self.report(job_id, progress=5, message=f"Беру «{name}» из архива CRM ({mb:.0f} МБ)…"):
                raise _Cancelled()
            try:
                self.crm.download_file(
                    f"/apps/{job['app_id']}/ipa", cached,
                    progress=lambda p: self.report(job_id, progress=5 + p * 35 // 100,
                                                   message=f"Беру «{name}» из архива CRM… {p}%"),
                )
                return cached, "архива CRM"
            except CrmError as exc:
                log.warning("Архив CRM не отдал файл, качаю у Apple: %s", exc)

        if self.report(job_id, progress=5, message=f"Скачиваю «{name}» у Apple…"):
            raise _Cancelled()
        path, from_cache = self.ipatool.download(job["adam_id"], job.get("version_id"))
        if not from_cache and job.get("app_id"):
            self._archive_later(job["app_id"], path, name)
        return path, "кэша станции" if from_cache else "Apple"

    def _archive_later(self, app_id: int, path: Path, name: str) -> None:
        """Сохранить скачанный у Apple файл в архив CRM — в фоне, установку не задерживаем."""
        def upload() -> None:
            try:
                self.crm.upload_file(f"/apps/{app_id}/ipa", path)
                log.info("«%s» сохранено в архив CRM", name)
            except CrmError as exc:
                log.warning("Не удалось сохранить «%s» в архив CRM: %s", name, exc)

        threading.Thread(target=upload, name=f"archive-{app_id}", daemon=True).start()

    def _install(self, job: dict) -> None:
        job_id = job["id"]
        name = job.get("app_name") or "приложение"
        try:
            path, source = self._get_ipa(job)
        except _Cancelled:
            return
        size_mb = path.stat().st_size / 1_048_576
        if self.report(job_id, progress=40, message=f"Файл из {source} ({size_mb:.0f} МБ). Ставлю на телефон…"):
            return

        last = {"sent": 0.0, "value": 40}

        def on_progress(percent: int) -> None:
            value = 40 + int(percent * 0.6)
            now = time.monotonic()
            if value > last["value"] and now - last["sent"] > 1.5:
                last.update(sent=now, value=value)
                self.report(job_id, progress=min(value, 99), message=f"Установка… {percent}%")

        device.install_ipa(job["target_udid"], path, progress=on_progress)
        self.report(job_id, state="done",
                    message=f"«{name}» установлено (файл из {source}). На телефоне в App Store должен быть вход в тот же Apple ID.")

    # ------------------------------------------------------------- главный цикл

    def run(self) -> None:
        log.info("Помощник %s запущен, CRM: %s", config.VERSION, self.settings.crm_url)
        threading.Thread(target=APPLE_PROXY.url, name="tunnel", daemon=True).start()  # поднять туннель заранее
        threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True).start()
        failures = 0
        while not self.stop.is_set():
            try:
                job = self.crm.post("/next")
                failures = 0
                if job:
                    self.run_job(job)
                    continue  # сразу проверяем следующую
            except CrmError as exc:
                if exc.status == 401 and self.reload_token():
                    continue
                failures += 1
                if failures in (1, 10) or failures % 100 == 0:
                    log.warning("Не получил задачи (%s раз): %s", failures, exc)
            except Exception:  # noqa: BLE001
                log.exception("Сбой цикла задач")
            self.stop.wait(POLL_SEC if failures < 5 else 15)
