"""Android-телефоны через adb (только stdlib): список устройств и копирование фото/видео или всей памяти."""

from __future__ import annotations

import errno
import logging
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Callable, Sequence

log = logging.getLogger(__name__)

__all__ = ["AndroidError", "adb_path", "list_android", "backup_media", "backup_full"]

ADB_MISSING = "Не найден adb. Установите Android platform-tools (папка platform-tools в каталоге помощника или в PATH)."
NO_SPACE = "На диске не хватает места. Освободите место или выберите другую папку или флешку."
MEDIA_DIRS = ("/sdcard/DCIM", "/sdcard/Pictures", "/sdcard/Movies")
FULL_DIR_NAME = "память_телефона"
_PROGRESS_RE = re.compile(r"^\[\s*\d+%\]")
_PULLED_RE = re.compile(r"(\d+)\s+files?\s+pulled", re.IGNORECASE)

ProgressCb = Callable[[int], None]


class AndroidError(Exception):
    code = "ANDROID_ERROR"


def _kwargs() -> dict:
    flag = getattr(subprocess, "CREATE_NO_WINDOW", None) if os.name == "nt" else None
    return {"creationflags": flag} if flag else {}


def _run(args: Sequence[str], timeout: float) -> subprocess.CompletedProcess:
    return subprocess.run(list(args), stdin=subprocess.DEVNULL, capture_output=True, encoding="utf-8",
                          errors="replace", timeout=timeout, **_kwargs())


def _quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def adb_path() -> str | None:
    """ADB_PATH → PATH → <каталог помощника>/platform-tools."""
    env = (os.environ.get("ADB_PATH") or "").strip()
    name = "adb.exe" if os.name == "nt" else "adb"
    if env:
        p = Path(env).expanduser()
        if p.is_file():
            return str(p)
        if (p / name).is_file():
            return str(p / name)
    found = shutil.which("adb")
    if found:
        return found
    try:
        from . import config

        candidate = Path(config.data_dir()) / "platform-tools" / name
        if candidate.is_file():
            return str(candidate)
    except Exception:  # noqa: BLE001
        log.debug("data_dir недоступен", exc_info=True)
    return None


def _getprop(adb: str, serial: str, prop: str) -> str:
    try:
        proc = _run([adb, "-s", serial, "shell", "getprop", prop], 5)
        return (proc.stdout or "").strip() if proc.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def list_android() -> list[dict]:
    """Подключённые Android-телефоны в том же виде, что и айфоны; пусто, если adb нет."""
    adb = adb_path()
    if not adb:
        return []
    try:
        proc = _run([adb, "devices", "-l"], 10)
    except Exception as exc:  # noqa: BLE001
        log.warning("adb devices не удался: %s", exc)
        return []
    if proc.returncode != 0:
        return []
    result: list[dict] = []
    for line in (proc.stdout or "").splitlines():
        parts = line.strip().split()
        if len(parts) < 2 or line.startswith(("*", "List of devices")):
            continue
        serial, state = parts[0], parts[1]
        attrs = dict(t.split(":", 1) for t in parts[2:] if ":" in t)
        paired = state == "device"
        name = (attrs.get("model") or "").replace("_", " ") or serial
        version = None
        if paired:
            name = _getprop(adb, serial, "ro.product.model") or name
            release = _getprop(adb, serial, "ro.build.version.release")
            version = f"Android {release}" if release else None
        problem = None
        if state == "unauthorized":
            problem = "Разрешите отладку по USB на телефоне (всплывающее окно «Разрешить»)"
        elif state == "offline":
            problem = "Телефон не отвечает: переподключите кабель"
        elif not paired:
            problem = f"Состояние: {state}"
        device_code = attrs.get("device")
        result.append({"udid": f"android:{serial}", "name": name,
                       "product_type": f"Android {device_code}" if device_code else "Android",
                       "ios_version": version, "paired": paired, "problem": problem})
    return result


def _count_remote(adb: str, serial: str, remote: str) -> int:
    try:
        exists = _run([adb, "-s", serial, "shell", f"[ -d {_quote(remote)} ] && echo yes"], 10)
        if "yes" not in (exists.stdout or ""):
            return 0
        proc = _run([adb, "-s", serial, "shell", f"find {_quote(remote)} -type f"], 120)
    except (OSError, subprocess.SubprocessError):
        return 0
    return sum(1 for line in (proc.stdout or "").splitlines() if line.strip()) if proc.returncode == 0 else 0


def _pull(adb: str, serial: str, remote: str, local: Path, total: int, done: int,
          progress: ProgressCb | None, state: dict) -> int:
    try:
        local.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen([adb, "-s", serial, "pull", remote, str(local)], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
                                bufsize=1, **_kwargs())
    except OSError as exc:
        if exc.errno == errno.ENOSPC:
            raise AndroidError(NO_SPACE) from exc
        raise AndroidError(ADB_MISSING if isinstance(exc, FileNotFoundError) else f"Не удалось начать копирование: {exc}") from exc

    errors: list[str] = []
    reader = threading.Thread(target=lambda: errors.extend(proc.stderr), daemon=True)  # type: ignore[arg-type]
    reader.start()
    seen = reported = 0
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            text = line.strip()
            if "No space left" in text:
                raise AndroidError(NO_SPACE)
            if _PROGRESS_RE.match(text):
                seen += 1
                done += 1
                percent = min(99, int(done * 100 / total)) if total else 0
                if progress and percent > state["last"]:
                    state["last"] = percent
                    try:
                        progress(percent)
                    except Exception:  # noqa: BLE001
                        log.debug("progress callback failed", exc_info=True)
            elif (m := _PULLED_RE.search(text)):
                reported = int(m.group(1))
        code = proc.wait()
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        reader.join(timeout=5)
    if seen == 0:
        done += reported
    err = "".join(errors).strip()
    if "No space left" in err:
        raise AndroidError(NO_SPACE)
    if code != 0:
        raise AndroidError(f"Не удалось скопировать {remote}: {err or f'код {code}'}")
    return done


def _size(path: Path) -> tuple[int, int]:
    files = size = 0
    for root, _d, names in os.walk(path):
        for n in names:
            files += 1
            try:
                size += (Path(root) / n).stat().st_size
            except OSError:
                pass
    return files, size


def _pull_dirs(serial: str, dirs: Sequence[tuple[str, str]], dest: str | Path, progress: ProgressCb | None,
               empty: str) -> dict:
    adb = adb_path()
    if not adb:
        raise AndroidError(ADB_MISSING)
    found = [(remote, name, _count_remote(adb, serial, remote)) for remote, name in dirs]
    found = [f for f in found if f[2] > 0]
    total = sum(f[2] for f in found)
    if not total:
        raise AndroidError(empty)
    base = Path(dest).expanduser()
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise AndroidError(NO_SPACE if exc.errno == errno.ENOSPC else f"Не удалось создать папку {base}: {exc}") from exc
    state = {"last": -1}
    done = 0
    files = size = 0
    for remote, name, _count in found:
        done = _pull(adb, serial, remote, base / name, total, done, progress, state)
        f, s = _size(base / name)
        files, size = files + f, size + s
    return {"files": files, "bytes": size, "total": total}


def backup_media(serial: str, folder: str | Path, progress: ProgressCb | None = None) -> dict:
    """Фото и видео (DCIM, Pictures, Movies). Возвращает {files, bytes, total}."""
    return _pull_dirs(serial, [(d, Path(d).name) for d in MEDIA_DIRS], folder, progress,
                      "На телефоне не найдены фото и видео")


def backup_full(serial: str, folder: str | Path, progress: ProgressCb | None = None) -> Path:
    """Вся память пользователя (/sdcard): фото, видео, документы, загрузки. Без приложений и системных данных."""
    _pull_dirs(serial, [("/sdcard", FULL_DIR_NAME)], folder, progress, "На телефоне не найдена память пользователя")
    return Path(folder).expanduser() / FULL_DIR_NAME
