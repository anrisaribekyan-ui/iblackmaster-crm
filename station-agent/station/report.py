"""Отчёт об устройстве: модель, серийные номера, память, состояние батареи (pymobiledevice3 11.x, async)."""

from __future__ import annotations

import asyncio
from typing import Any

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.diagnostics import DiagnosticsService

__all__ = ["collect_report", "format_report_text"]

_GB = 1024 ** 3

_MODEL_NAMES: dict[str, str] = {
    "iPhone10,1": "iPhone 8", "iPhone10,4": "iPhone 8",
    "iPhone10,2": "iPhone 8 Plus", "iPhone10,5": "iPhone 8 Plus",
    "iPhone10,3": "iPhone X", "iPhone10,6": "iPhone X",
    "iPhone11,2": "iPhone XS", "iPhone11,4": "iPhone XS Max", "iPhone11,6": "iPhone XS Max",
    "iPhone11,8": "iPhone XR", "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro",
    "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE (2-го поколения)",
    "iPhone13,1": "iPhone 12 mini", "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro",
    "iPhone13,4": "iPhone 12 Pro Max", "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13",
    "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max",
    "iPhone14,6": "iPhone SE (3-го поколения)", "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus",
    "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max", "iPhone15,4": "iPhone 15",
    "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
    "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,1": "iPhone 16 Pro",
    "iPhone17,2": "iPhone 16 Pro Max", "iPhone17,5": "iPhone 16e",
}

_EXTRA_KEYS = ("BatterySerialNumber", "FrontCameraSerialNumber", "BackCameraSerialNumber", "MLBSerialNumber")
_EXTRA_TITLES = {
    "BatterySerialNumber": "Аккумулятор",
    "FrontCameraSerialNumber": "Фронтальная камера",
    "BackCameraSerialNumber": "Основная камера",
    "MLBSerialNumber": "Плата (MLB)",
}


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


def _to_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _gb(value: Any) -> float | None:
    num = _to_int(value)
    return round(num / _GB, 1) if num and num > 0 else None


def _battery_health(batt: dict[str, Any]) -> int | None:
    design = _to_int(batt.get("DesignCapacity"))
    nominal = _to_int(batt.get("NominalChargeCapacity"))
    raw_max = _to_int(batt.get("AppleRawMaxCapacity"))
    max_cap = _to_int(batt.get("MaxCapacity"))
    if design and design > 0:
        if nominal and nominal > 0:
            return round(nominal * 100 / design)
        if raw_max and raw_max > 0:
            return round(raw_max * 100 / design)
    if max_cap is not None and 1 <= max_cap <= 100:
        return max_cap
    return None


def collect_report(udid: str) -> dict:
    """Собирает отчёт об устройстве. Ошибки подключения летят наверх."""
    return asyncio.run(_collect(udid))


async def _collect(udid: str) -> dict:
    lockdown = await create_using_usbmux(serial=udid, autopair=True, pair_timeout=30)
    try:
        info: dict[str, Any] = await lockdown.get_value() or {}
        try:
            disk: dict[str, Any] = await lockdown.get_value("com.apple.disk_usage") or {}
        except Exception:  # noqa: BLE001
            disk = {}

        battery: dict[str, Any] = {}
        battery_error: str | None = None
        try:
            async with DiagnosticsService(lockdown) as svc:
                battery = await svc.get_battery() or {}
        except Exception as exc:  # noqa: BLE001 — батарея не должна ронять отчёт
            battery_error = f"{type(exc).__name__}: {exc}"

        product_type = info.get("ProductType")
        storage_total = _gb(disk.get("TotalDiskCapacity"))
        storage_free = _gb(disk.get("TotalDataAvailable"))
        health = _battery_health(battery)
        cycles = _to_int(battery.get("CycleCount"))
        current_max = (_to_int(battery.get("NominalChargeCapacity"))
                       or _to_int(battery.get("AppleRawMaxCapacity")) or _to_int(battery.get("MaxCapacity")))
        try:
            temp = float(battery["Temperature"]) / 100.0 if battery.get("Temperature") is not None else None
        except (TypeError, ValueError):
            temp = None
        activation = info.get("ActivationState")

        extra = {k: str(info[k]) for k in _EXTRA_KEYS if info.get(k) not in (None, "", b"")}

        warnings: list[str] = []
        if health is not None and health < 80:
            warnings.append(f"Батарея изношена ({health} %) — рекомендуем замену")
        if cycles is not None and cycles > 800:
            warnings.append(f"Много циклов зарядки ({cycles})")
        if _to_bool(battery.get("BatteryInvalid")):
            warnings.append("Батарея не определяется")
        if activation is not None and activation != "Activated":
            warnings.append("Устройство не активировано")
        if storage_total and storage_free is not None and storage_free < storage_total * 0.1:
            warnings.append("Мало свободной памяти")

        return {
            "udid": udid,
            "name": info.get("DeviceName"),
            "model_name": _MODEL_NAMES.get(product_type) or product_type,
            "product_type": product_type,
            "ios_version": info.get("ProductVersion"),
            "serial": info.get("SerialNumber"),
            "imei": info.get("InternationalMobileEquipmentIdentity"),
            "imei2": info.get("InternationalMobileEquipmentIdentity2"),
            "model_number": info.get("ModelNumber"),
            "region": info.get("RegionInfo"),
            "activation_state": activation,
            "storage_total_gb": storage_total,
            "storage_free_gb": storage_free,
            "battery": {
                "health_percent": health,
                "cycle_count": cycles,
                "design_mah": _to_int(battery.get("DesignCapacity")),
                "current_max_mah": current_max,
                "charge_percent": _to_int(battery.get("CurrentCapacity")),
                "is_charging": _to_bool(battery.get("IsCharging")),
                "temperature_c": round(temp, 1) if temp is not None else None,
                "voltage_mv": _to_int(battery.get("Voltage")),
            },
            "battery_error": battery_error,
            "extra": extra,
            "warnings": warnings,
        }
    finally:
        await lockdown.close()


def _fmt(value: Any, suffix: str = "") -> str:
    return "—" if value is None or value == "" else f"{value}{suffix}"


def format_report_text(report: dict) -> str:
    """Русский текст отчёта для печати клиенту."""
    b = report.get("battery") or {}
    sep = "=" * 46
    total, free = report.get("storage_total_gb"), report.get("storage_free_gb")
    memory = (f"{total} ГБ (свободно {free} ГБ)" if total is not None and free is not None else _fmt(total, " ГБ"))
    charging = b.get("is_charging")
    lines = [
        sep, "ОТЧЁТ ОБ УСТРОЙСТВЕ", sep,
        f"Устройство: {_fmt(report.get('model_name'))}",
        f"Версия iOS: {_fmt(report.get('ios_version'))}",
        f"Серийный номер: {_fmt(report.get('serial'))}",
        f"IMEI: {_fmt(report.get('imei'))}",
        f"IMEI 2: {_fmt(report.get('imei2'))}",
        f"Номер модели: {_fmt(report.get('model_number'))}",
        f"Активация: {_fmt(report.get('activation_state'))}",
        f"Память: {memory}",
        "-" * 46, "АККУМУЛЯТОР",
        f"  Состояние (ёмкость): {_fmt(b.get('health_percent'), ' %')}",
        f"  Циклов зарядки: {_fmt(b.get('cycle_count'))}",
        f"  Ёмкость новой: {_fmt(b.get('design_mah'), ' мАч')}",
        f"  Ёмкость сейчас: {_fmt(b.get('current_max_mah'), ' мАч')}",
        f"  Заряд: {_fmt(b.get('charge_percent'), ' %')}"
        + ("" if charging is None else (", заряжается" if charging else "")),
        f"  Температура: {_fmt(b.get('temperature_c'), ' °C')}",
    ]
    if report.get("battery_error"):
        lines.append(f"  Ошибка чтения: {report['battery_error']}")
    extra = report.get("extra") or {}
    if extra:
        lines += ["-" * 46, "СЕРИЙНЫЕ НОМЕРА ДЕТАЛЕЙ"]
        lines += [f"  {_EXTRA_TITLES.get(k, k)}: {v}" for k, v in extra.items()]
    warnings = report.get("warnings") or []
    if warnings:
        lines += ["-" * 46, "РЕКОМЕНДАЦИИ"] + [f"  ! {w}" for w in warnings]
    lines.append(sep)
    return "\n".join(lines)
