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
from pymobiledevice3.services.installation_proxy import InstallationProxyService
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
    """[{udid, name, product_type, ios_version, paired, problem}]"""
    return asyncio.run(_list_devices())


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


__all__ = [
    "DeviceError", "NotPaired", "DeviceGone", "InstallFailed",
    "list_devices", "scan_apps", "install_ipa", "PyMobileDevice3Exception",
]
