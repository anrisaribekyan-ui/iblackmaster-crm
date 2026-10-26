"""Настройки помощника.

Всё хранится в папке данных пользователя:
- Windows: %APPDATA%\\iBlackMaster Station
- macOS:   ~/Library/Application Support/iBlackMaster Station
- Linux:   ~/.local/share/iblackmaster-station
config.json — адрес CRM, токен станции, пароль хранилища ipatool (генерируется сам).
Переменные окружения и .env рядом с программой перекрывают config.json (удобно для разработки).
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import os
import secrets
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

APP_NAME = "iBlackMaster Station"
VERSION = "1.0.0"


def app_dir() -> Path:
    """Папка программы: рядом с .exe у установленной версии, корень проекта у исходников."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    override = os.getenv("STATION_DATA_DIR")
    if override:
        base = Path(override)
    elif sys.platform == "win32":
        base = Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming") / APP_NAME
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / APP_NAME
    else:
        base = Path(os.getenv("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "iblackmaster-station"
    base.mkdir(parents=True, exist_ok=True)
    return base


load_dotenv(app_dir() / ".env")


def os_name() -> str:
    return {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")


def _find_ipatool() -> str | None:
    explicit = os.getenv("IPATOOL_PATH")
    if explicit:
        return explicit
    name = "ipatool.exe" if sys.platform == "win32" else "ipatool"
    for candidate in (app_dir() / name, app_dir() / "bin" / name):
        if candidate.is_file():
            return str(candidate)
    return shutil.which("ipatool")


def _config_path() -> Path:
    return data_dir() / "config.json"


def read_config() -> dict:
    try:
        return json.loads(_config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_config(values: dict) -> None:
    current = read_config()
    current.update(values)
    path = _config_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _decode_code(chunk: str) -> tuple[str, str] | None:
    chunk = chunk.replace("-", "+").replace("_", "/")
    try:
        data = json.loads(base64.b64decode(chunk + "=" * (-len(chunk) % 4)).decode("utf-8"))
        url, token = str(data["url"]).rstrip("/"), str(data["token"])
    except (binascii.Error, ValueError, KeyError, TypeError, UnicodeDecodeError, AttributeError):
        return None
    if not url.startswith(("http://", "https://")) or not token.startswith("st_"):
        return None
    return url, token


def parse_connection_code(code: str) -> tuple[str, str]:
    """Код из CRM (base64 от {"url","token"}) → (адрес CRM, токен станции).

    Терпим к мусору вокруг: кавычки, пробелы, переносы строк, лишний текст
    (например, вставили вместе с командой) — ищем внутри сам код.
    """
    text = code or ""
    candidates = ["".join(text.split())]
    candidates += sorted(re.findall(r"[A-Za-z0-9+/_-]{40,}={0,2}", text), key=len, reverse=True)
    for chunk in candidates:
        found = _decode_code(chunk.strip("\"'«»`"))
        if found:
            return found
    shown = " ".join(text.split())
    hint = f" (вставлено: «{shown[:40]}{'…' if len(shown) > 40 else ''}»)" if shown else " (вставлена пустая строка)"
    raise ValueError(
        "Код подключения не подходит: в CRM нажмите «Скопировать код» и вставьте его целиком" + hint
    )


@dataclass(frozen=True)
class Settings:
    crm_url: str
    station_token: str
    ipatool_path: str | None
    keychain_passphrase: str
    apple_id_email: str
    cache_dir: Path
    log_dir: Path


def load() -> Settings:
    cfg = read_config()
    passphrase = os.getenv("IPATOOL_KEYCHAIN_PASSPHRASE") or cfg.get("keychain_passphrase")
    if not passphrase:
        passphrase = secrets.token_urlsafe(24)
        write_config({"keychain_passphrase": passphrase})
    root = data_dir()
    cache = Path(os.getenv("IPA_CACHE_DIR") or root / "ipa_cache")
    logs = root / "logs"
    cache.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    return Settings(
        crm_url=(os.getenv("CRM_URL") or cfg.get("crm_url") or "").rstrip("/"),
        station_token=os.getenv("STATION_TOKEN") or cfg.get("station_token") or "",
        ipatool_path=_find_ipatool(),
        keychain_passphrase=passphrase,
        apple_id_email=os.getenv("APPLE_ID_EMAIL") or cfg.get("apple_id_email") or "",
        cache_dir=cache,
        log_dir=logs,
    )
