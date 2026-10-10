"""Настройки CRM: значения по умолчанию + то, что изменили в таблице app_setting.

get(db, key) всегда возвращает полный словарь: недостающие поля берутся из DEFAULTS,
поэтому новые поля настроек появляются без миграций.
"""

from copy import deepcopy

from sqlalchemy.orm import Session

from app.models import AppSetting

DEFAULTS: dict[str, dict] = {
    # Готовые, но не забранные аппараты (ТЗ этап 3, E1)
    "forgotten": {
        "list_days": 14,  # с какого дня аппарат считается «забытым» в списке и на плитке
        "reminders_active": False,  # SMS-напоминания выключены, пока владелец не включит
        "reminder_days": [3, 7, 30],
        "reminder_text": "Здравствуйте, {имя}! Ваш {устройство} готов и ждёт вас уже {дней} дн. "
        "{точка}, {адрес}, {часы}. iBlackMaster",
    },
    # Чек-лист проверки аппарата при приёме и выдаче (ТЗ этап 3, E5)
    "checklist": {
        "items": [
            "Включается",
            "Экран и сенсор",
            "Face ID / Touch ID",
            "Основная камера",
            "Фронтальная камера",
            "Динамик",
            "Микрофон",
            "Вибро и кнопки",
            "Wi-Fi и Bluetooth",
            "Сеть и SIM",
            "Зарядка",
        ],
    },
}


def get(db: Session, key: str) -> dict:
    value = deepcopy(DEFAULTS.get(key, {}))
    row = db.get(AppSetting, key)
    if row is not None and isinstance(row.value, dict):
        value.update(row.value)
    return value


def put(db: Session, key: str, value: dict) -> dict:
    """Сохраняет только известные поля (из DEFAULTS), лишнее отбрасывает."""
    allowed = DEFAULTS.get(key, {})
    clean = {k: v for k, v in value.items() if k in allowed}
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=clean)
        db.add(row)
    else:
        row.value = {**(row.value or {}), **clean}
    db.flush()
    return get(db, key)
