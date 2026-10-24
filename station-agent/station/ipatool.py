"""Обёртка над ipatool (github.com/majd/ipatool): вход, список покупок, скачивание IPA."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

from .config import Settings

log = logging.getLogger(__name__)

_AUTH_MARKERS = (
    "auth code is required",
    "2fa code is required",  # --non-interactive без кода: ipatool пишет это и выходит с кодом 0
    "password token is expired",
    "account not found",
    "account unavailable",
    "an apple id is required",
    "apple did not complete verification",
    "2fa code must contain",
    "invalid credentials",
)
_UNAVAILABLE_MARKERS = (
    "app not found",
    "license is required",
    "item is not available",
    "not available in",
)


class IpatoolError(Exception):
    code = "IPATOOL_ERROR"
    exit_code = 2


class NotInstalled(IpatoolError):
    code = "IPATOOL_MISSING"


class AuthRequired(IpatoolError):
    code = "AUTH_REQUIRED"
    exit_code = 3


class AppleUnreachable(IpatoolError):
    code = "APPLE_UNREACHABLE"
    exit_code = 5


class AppUnavailable(IpatoolError):
    code = "APP_UNAVAILABLE"
    exit_code = 4


_NET_MARKERS = ("tls handshake timeout", "i/o timeout", "connection refused", "connection reset",
                "no such host", "network is unreachable", "failed to make round trip", "socks connect")


def _classify(message: str) -> IpatoolError:
    low = message.lower()
    if any(m in low for m in _NET_MARKERS):
        return AppleUnreachable(
            "Серверы Apple не открываются с этого компьютера. Включите туннель (ssh-tunnel) или прокси для Apple "
            f"на станции. ({message[:200]})")
    if any(m in low for m in _AUTH_MARKERS):
        return AuthRequired(f"Нужен вход в Apple ID ({message})")
    if any(m in low for m in _UNAVAILABLE_MARKERS):
        return AppUnavailable(f"Apple не отдаёт это приложение под этим Apple ID ({message})")
    return IpatoolError(message)


def _parse_json_lines(text: str) -> list[dict[str, Any]]:
    events = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


class Ipatool:
    def __init__(self, settings: Settings):
        self.s = settings

    def _run(self, args: list[str], secret: Optional[str] = None, timeout: int = 1800) -> dict[str, Any]:
        if not self.s.ipatool_path:
            raise NotInstalled(
                "ipatool не найден: положите его в папку bin/ или укажите IPATOOL_PATH в .env"
            )
        cmd = [self.s.ipatool_path, *args, "--format", "json", "--non-interactive"]
        if self.s.keychain_passphrase:
            cmd += ["--keychain-passphrase", self.s.keychain_passphrase]

        shown = " ".join("***" if secret and a == secret else a for a in cmd)
        shown = shown.replace(self.s.keychain_passphrase, "***") if self.s.keychain_passphrase else shown
        from .tunnel import APPLE_PROXY

        env = dict(os.environ)
        proxy = APPLE_PROXY.url()
        if proxy:  # серверы Apple из России открываются не все — идём через прокси/туннель
            env["HTTPS_PROXY"] = env["HTTP_PROXY"] = proxy
            env.pop("NO_PROXY", None)
        log.info("ipatool%s: %s", f" (через {proxy})" if proxy else "", shown)

        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                                  errors="replace", timeout=timeout, env=env, creationflags=flags)
        except FileNotFoundError as exc:
            raise NotInstalled(f"Не запускается ipatool: {self.s.ipatool_path}") from exc
        except subprocess.TimeoutExpired as exc:
            raise IpatoolError("ipatool не ответил вовремя") from exc

        events = _parse_json_lines(proc.stdout + "\n" + proc.stderr)
        result = next((e for e in reversed(events) if "success" in e), None)
        log.debug("ipatool exit=%s events=%s", proc.returncode, events)

        if result and result.get("success") and proc.returncode == 0:
            return result
        last = events[-1] if events else {}
        message = (result or {}).get("error") or last.get("error") or last.get("message") \
            or proc.stderr.strip() or proc.stdout.strip() or f"ipatool завершился с кодом {proc.returncode}"
        raise _classify(message)

    # --- команды ---

    def login(self, email: str, password: str, auth_code: Optional[str] = None) -> dict[str, Any]:
        args = ["auth", "login", "--email", email, "--password", password]
        if auth_code:
            args += ["--auth-code", auth_code]
        return self._run(args, secret=password, timeout=600)  # первый вход бывает долгим

    def info(self) -> dict[str, Any]:
        return self._run(["auth", "info"], timeout=60)

    def purchases(self, page: int = 1, limit: int = 100) -> dict[str, Any]:
        return self._run(["list-purchases", "--page", str(page), "--max-results", str(limit)], timeout=120)

    def cached_path(self, adam_id: int, version_id: Optional[int]) -> Path:
        return self.s.cache_dir / f"{adam_id}_{version_id or 'latest'}.ipa"

    def download(self, adam_id: int, version_id: Optional[int] = None, force: bool = False) -> tuple[Path, bool]:
        """Возвращает (путь к IPA, взято_из_кэша)."""
        target = self.cached_path(adam_id, version_id)
        if target.is_file() and target.stat().st_size > 0 and not force:
            return target, True
        tmp = target.with_suffix(".part.ipa")
        args = ["download", "--app-id", str(adam_id), "--purchase", "-o", str(tmp)]
        if version_id:
            args += ["--external-version-id", str(version_id)]
        try:
            result = self._run(args)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        produced = Path(result.get("output") or tmp)
        if produced != target:
            produced.replace(target)
        return target, False
