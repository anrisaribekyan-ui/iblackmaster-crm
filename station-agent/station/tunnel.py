"""Прокси для серверов Apple.

Из России часть серверов Apple (скачивание приложений, служебные файлы) не открывается.
ipatool умеет ходить через прокси (переменная HTTPS_PROXY), поэтому:
- apple_proxy в config.json — готовый адрес прокси (например socks5://127.0.0.1:1080 от VPN-клиента);
- ssh_tunnel в config.json — сервер за границей (user@host): помощник сам держит SSH-туннель
  `ssh -D 127.0.0.1:47812 user@host` и пускает ipatool через него. Вход на сервер — по ключу.
"""

from __future__ import annotations

import logging
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Optional

from . import config

log = logging.getLogger("station.tunnel")

TUNNEL_PORT = 47812


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


class AppleProxy:
    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self.last_error: Optional[str] = None

    def _settings(self) -> tuple[str, str]:
        cfg = config.read_config()
        return (cfg.get("apple_proxy") or "").strip(), (cfg.get("ssh_tunnel") or "").strip()

    def url(self) -> Optional[str]:
        """Адрес прокси для ipatool или None (ходить напрямую)."""
        proxy, ssh_host = self._settings()
        if proxy:
            return proxy
        if ssh_host:
            self.ensure_tunnel(ssh_host)
            return f"socks5://127.0.0.1:{TUNNEL_PORT}"
        return None

    def describe(self) -> str:
        proxy, ssh_host = self._settings()
        if proxy:
            return f"прокси {proxy}"
        if ssh_host:
            state = "работает" if _port_open(TUNNEL_PORT) else f"не поднят ({self.last_error or 'нет связи'})"
            return f"туннель через {ssh_host}: {state}"
        return "напрямую"

    def ensure_tunnel(self, ssh_host: str) -> bool:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None and _port_open(TUNNEL_PORT):
                return True
            if self._proc is not None and self._proc.poll() is None:
                self._proc.terminate()
            ssh = shutil.which("ssh") or ("C:\\Windows\\System32\\OpenSSH\\ssh.exe" if sys.platform == "win32" else None)
            if not ssh:
                self.last_error = "нет программы ssh"
                log.error("Туннель: на компьютере нет ssh")
                return False
            cmd = [
                ssh, "-N", "-D", f"127.0.0.1:{TUNNEL_PORT}",
                "-o", "BatchMode=yes",  # без пароля: только ключ, иначе тихо падаем
                "-o", "ExitOnForwardFailure=yes",
                # Провайдеры режут «тихие» долгие SSH: без частых keepalive большие загрузки обрывались (EOF)
                "-o", "ServerAliveInterval=15",
                "-o", "ServerAliveCountMax=4",
                "-o", "TCPKeepAlive=yes",
                "-o", "StrictHostKeyChecking=accept-new",
                "-o", "ConnectTimeout=15",
                ssh_host,
            ]
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self._proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.PIPE, creationflags=flags)
            for _ in range(40):  # до 20 с
                if _port_open(TUNNEL_PORT):
                    self.last_error = None
                    log.info("Туннель к %s поднят", ssh_host)
                    return True
                if self._proc.poll() is not None:
                    break
                time.sleep(0.5)
            err = ""
            if self._proc.poll() is not None and self._proc.stderr:
                err = self._proc.stderr.read().decode("utf-8", "replace").strip()[-300:]
            self.last_error = err or "сервер не ответил"
            log.error("Туннель к %s не поднялся: %s", ssh_host, self.last_error)
            return False

    def stop(self) -> None:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                self._proc.terminate()
            self._proc = None


APPLE_PROXY = AppleProxy()
