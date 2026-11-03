"""Работа с айфонами, подключёнными по USB (pymobiledevice3 11.x)."""

from __future__ import annotations

import asyncio
import logging
import plistlib
from pathlib import Path
from typing import Any, Callable, Optional

from pymobiledevice3.exceptions import (
    AppInstallError,
    ConnectionFailedError,
    ConnectionTerminatedError,
    DeviceNotFoundError,
    NoDeviceConnectedError,
    NotPairedError,
    NotTrustedError,
    PairingDialogResponsePendingError,
    PairingError,
    PasswordRequiredError,
    PyMobileDevice3Exception,
    UserDeniedPairingError,
)
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.afc import AfcService
from pymobiledevice3.services.installation_proxy import InstallationProxyService
from pymobiledevice3.services.mobilebackup2 import Mobilebackup2Service
from pymobiledevice3.usbmux import list_devices as usbmux_list_devices

log = logging.getLogger(__name__)

ProgressCb = Callable[[int], None]

_GONE = (DeviceNotFoundError, NoDeviceConnectedError, ConnectionFailedError, ConnectionTerminatedError)
_NOT_PAIRED = (
    PairingError,  # включает PasswordRequired, UserDenied, PairingDialogResponsePending
    NotPairedError,
    NotTrustedError,
)

APP_ATTRIBUTES = [
    "CFBundleIdentifier",
    "CFBundleDisplayName",
    "CFBundleName",
    "CFBundleShortVersionString",
    "iTunesMetadata",
]


class DeviceError(Exception):
    code = "DEVICE_ERROR"


class NotPaired(DeviceError):
    code = "NOT_PAIRED"


class DeviceGone(DeviceError):
    code = "DEVICE_GONE"


class InstallFailed(DeviceError):
    code = "INSTALL_FAILED"


def _pairing_message(exc: BaseException) -> str:
    if isinstance(exc, PasswordRequiredError):
        return "Телефон заблокирован: разблокируйте его и повторите"
    if isinstance(exc, PairingDialogResponsePendingError):
        return "На телефоне висит вопрос «Доверять этому компьютеру?» — нажмите «Доверять»"
    if isinstance(exc, UserDeniedPairingError):
        return "На телефоне нажали «Не доверять». Переподключите кабель и нажмите «Доверять»"
    return "Телефон не доверяет компьютеру: разблокируйте и нажмите «Доверять»"


def _translate(exc: BaseException, udid: Optional[str]) -> DeviceError:
    if isinstance(exc, DeviceError):
        return exc
    if isinstance(exc, _GONE):
        return DeviceGone(f"Телефон {udid or ''} отключён или недоступен")
    if isinstance(exc, _NOT_PAIRED):
        return NotPaired(_pairing_message(exc))
    if isinstance(exc, AppInstallError):
        return InstallFailed(f"Установка не удалась: {exc}")
    return DeviceError(str(exc) or exc.__class__.__name__)


async def _lockdown(udid: str):
    try:
        return await create_using_usbmux(serial=udid, autopair=True, pair_timeout=30)
    except Exception as exc:  # noqa: BLE001
        raise _translate(exc, udid) from exc


def _parse_itunes_metadata(raw: Any) -> tuple[Optional[int], Optional[int]]:
    if not raw:
        return None, None
    try:
        meta = plistlib.loads(bytes(raw)) if isinstance(raw, (bytes, bytearray)) else raw
    except Exception:  # noqa: BLE001
        log.debug("Не удалось разобрать iTunesMetadata", exc_info=True)
        return None, None
    if not isinstance(meta, dict):
        return None, None

    def as_int(value: Any) -> Optional[int]:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    return as_int(meta.get("itemId")), as_int(meta.get("softwareVersionExternalIdentifier"))


def _parse_apple_id(raw: Any) -> Optional[str]:
    """Почта Apple ID, которым куплено приложение (из iTunesMetadata)."""
    if not raw:
        return None
    try:
        meta = plistlib.loads(bytes(raw)) if isinstance(raw, (bytes, bytearray)) else raw
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(meta, dict):
        return None
    info = (meta.get("com.apple.iTunesStore.downloadInfo") or {}).get("accountInfo") or {}
    for value in (meta.get("appleId"), info.get("AppleID") if isinstance(info, dict) else None):
        if isinstance(value, str) and "@" in value:
            return value.strip().lower()
    return None


def most_common_apple_id(items: list[Any]) -> Optional[str]:
    """Apple ID телефона = тот, которым куплено больше всего приложений на нём."""
    counts: dict[str, int] = {}
    for raw in items:
        found = _parse_apple_id(raw)
        if found:
            counts[found] = counts.get(found, 0) + 1
    return max(counts, key=counts.get) if counts else None


# ---------------- список устройств ----------------

async def _list_devices() -> list[dict]:
    try:
        muxed = await usbmux_list_devices()
    except Exception as exc:  # noqa: BLE001
        raise DeviceError(
            "Не удалось связаться со службой Apple Mobile Device. "
            "Windows: проверьте, что установлен iTunes или Apple Devices."
        ) from exc

    devices: list[dict] = []
    seen: set[str] = set()
    for dev in muxed:
        if dev.connection_type != "USB" or dev.serial in seen:
            continue
        seen.add(dev.serial)
        info = {"udid": dev.serial, "name": None, "product_type": None,
                "ios_version": None, "paired": False, "problem": None}
        try:
            # autopair=False: просто посмотреть, не вызывая диалог доверия
            lockdown = await create_using_usbmux(serial=dev.serial, autopair=False)
            try:
                values = lockdown.short_info
                info.update(
                    name=values.get("DeviceName"),
                    product_type=values.get("ProductType"),
                    ios_version=values.get("ProductVersion"),
                    paired=bool(lockdown.paired),
                )
                if not lockdown.paired:
                    info["problem"] = "Не доверяет компьютеру: разблокируйте и нажмите «Доверять»"
            finally:
                await lockdown.close()
        except Exception as exc:  # noqa: BLE001
            err = _translate(exc, dev.serial)
            if isinstance(err, DeviceGone):
                continue
            info["problem"] = str(err)
        devices.append(info)
    return devices


def list_devices() -> list[dict]:
    """[{udid, name, product_type, ios_version, paired, problem}] — айфоны и (если есть adb) Android-телефоны."""
    from . import android

    try:
        phones = asyncio.run(_list_devices())
    except DeviceError:
        phones = []
        if not android.adb_path():
            raise
    return phones + android.list_android()


# ---------------- скан приложений ----------------

async def _scan_apps(udid: str) -> list[dict]:
    lockdown = await _lockdown(udid)
    try:
        async with InstallationProxyService(lockdown) as svc:
            apps = await svc.lookup({"ApplicationType": "User", "ReturnAttributes": APP_ATTRIBUTES}) or {}
    except Exception as exc:  # noqa: BLE001
        raise _translate(exc, udid) from exc
    finally:
        await lockdown.close()

    _APPLE_IDS[udid] = most_common_apple_id([info.get("iTunesMetadata") for info in apps.values()])
    result = []
    for bundle_id, info in apps.items():
        adam_id, version_id = _parse_itunes_metadata(info.get("iTunesMetadata"))
        result.append({
            "name": info.get("CFBundleDisplayName") or info.get("CFBundleName") or bundle_id,
            "bundle_id": info.get("CFBundleIdentifier") or bundle_id,
            "version": info.get("CFBundleShortVersionString"),
            "adam_id": adam_id,
            "version_id": version_id,
            "from_app_store": adam_id is not None,
        })
    result.sort(key=lambda a: a["name"].lower())
    return result


_APPLE_IDS: dict[str, Optional[str]] = {}


def phone_apple_id(udid: str) -> Optional[str]:
    """Apple ID телефона по последнему чтению приложений (читает заново, если ещё не читали)."""
    if udid not in _APPLE_IDS:
        asyncio.run(_scan_apps(udid))
    return _APPLE_IDS.get(udid)


def scan_apps(udid: str) -> list[dict]:
    """[{name, bundle_id, version, adam_id, version_id, from_app_store}]"""
    return asyncio.run(_scan_apps(udid))


# ---------------- установка ----------------

async def _install(udid: str, ipa: Path, progress: Optional[ProgressCb]) -> None:
    lockdown = await _lockdown(udid)

    def handler(percent: Any, *_: Any) -> None:
        if progress is None:
            return
        try:
            progress(int(percent))
        except Exception:  # noqa: BLE001
            log.debug("progress callback failed", exc_info=True)

    try:
        async with InstallationProxyService(lockdown) as svc:
            await svc.install_from_local(ipa, handler=handler)
    except Exception as exc:  # noqa: BLE001
        err = _translate(exc, udid)
        if type(err) is DeviceError:
            err = InstallFailed(f"Установка не удалась: {err}")
        raise err from exc
    finally:
        await lockdown.close()


def install_ipa(udid: str, ipa_path: str | Path, progress: Optional[ProgressCb] = None) -> None:
    ipa = Path(ipa_path)
    if not ipa.is_file():
        raise InstallFailed(f"Файл не найден: {ipa}")
    if ipa.suffix.lower() != ".ipa":
        raise InstallFailed(f"Нужен файл .ipa, а не {ipa.name}")
    asyncio.run(_install(udid, ipa, progress))


# ---------------- копия данных ----------------

class BackupFailed(DeviceError):
    code = "BACKUP_FAILED"


def _backup_error(exc: BaseException, udid: str) -> DeviceError:
    if isinstance(exc, OSError) and getattr(exc, "errno", None) == 28:
        return BackupFailed("На диске не хватает места. Освободите место или выберите другую папку или флешку.")
    err = _translate(exc, udid)
    if type(err) is DeviceError:
        text = str(err)
        if "password" in text.lower() or "encrypt" in text.lower():
            return BackupFailed("Телефон просит пароль резервной копии. Отключите шифрование копий в Finder/iTunes или сообщите пароль мастеру.")
        return BackupFailed(f"Копирование не удалось: {text}")
    return err


async def _backup_full(udid: str, folder: Path, progress: Optional[ProgressCb]) -> None:
    lockdown = await _lockdown(udid)

    def handler(percent: Any, *_: Any) -> None:
        if progress is not None:
            try:
                progress(int(percent))
            except Exception:  # noqa: BLE001
                log.debug("progress callback failed", exc_info=True)

    try:
        async with Mobilebackup2Service(lockdown) as svc:
            await svc.backup(full=True, backup_directory=folder, progress_callback=handler)
    except Exception as exc:  # noqa: BLE001
        raise _backup_error(exc, udid) from exc
    finally:
        await lockdown.close()


def backup_full(udid: str, folder: str | Path, progress: Optional[ProgressCb] = None) -> Path:
    """Полная резервная копия (как в Finder/iTunes). Возвращает папку копии: <folder>/<UDID>."""
    target = Path(folder)
    target.mkdir(parents=True, exist_ok=True)
    asyncio.run(_backup_full(udid, target, progress))
    return target / udid


async def _backup_media(udid: str, folder: Path, progress: Optional[ProgressCb]) -> dict:
    lockdown = await _lockdown(udid)
    stats = {"files": 0, "bytes": 0}
    try:
        async with AfcService(lockdown) as afc:
            if not await afc.exists("DCIM"):
                raise BackupFailed("На телефоне нет папки с фото и видео (DCIM). Возможно, снимки хранятся только в iCloud.")
            total = 0
            async for _, _, files in afc.walk("DCIM"):
                total += len(files)
            if total == 0:
                raise BackupFailed("В папке DCIM нет файлов. Если «Фото iCloud» с оптимизацией хранилища, оригиналы лежат в облаке.")

            async def on_file(_src: str, dst: str) -> None:
                stats["files"] += 1
                try:
                    stats["bytes"] += Path(dst).stat().st_size
                except OSError:
                    pass
                if progress is not None:
                    try:
                        progress(min(99, int(stats["files"] * 100 / total)))
                    except Exception:  # noqa: BLE001
                        log.debug("progress callback failed", exc_info=True)

            await afc.pull("DCIM", str(folder), callback=on_file, ignore_errors=True, progress_bar=False)
    except DeviceError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _backup_error(exc, udid) from exc
    finally:
        await lockdown.close()
    stats["total"] = total
    return stats


def backup_media(udid: str, folder: str | Path, progress: Optional[ProgressCb] = None) -> dict:
    """Только фото и видео: папка DCIM телефона целиком в <folder>/DCIM. Возвращает {files, bytes, total}."""
    target = Path(folder)
    target.mkdir(parents=True, exist_ok=True)
    return asyncio.run(_backup_media(udid, target, progress))


__all__ = [
    "DeviceError", "NotPaired", "DeviceGone", "InstallFailed", "BackupFailed",
    "list_devices", "scan_apps", "install_ipa", "backup_full", "backup_media", "PyMobileDevice3Exception",
]
