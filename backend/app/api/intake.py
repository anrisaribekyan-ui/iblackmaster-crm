"""Подсказки на приёмке (ТЗ этап 3, C1 + C2).

C1. Узнавание клиента: номер вбит → сколько раз был, что чинили в последний раз, долг, «постоянный».
C2. Гарантия на лету: тот же аппарат (IMEI/серийник) или тот же клиент + модель ремонтировались,
    и гарантия по позициям ещё не истекла. Если сроков гарантии в заказе нет (так у перенесённых из LiveSklad),
    но ремонт был недавно — показываем мягкую подсказку «повторное обращение».

Смотрим по всем точкам: гарантию, выданную в Ленте, должны увидеть и в Панфиловском.
"""

import re
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter
from sqlalchemy import func, or_, select

from app.api.counteragents import require_order_read
from app.api.deps import CurrentEmployee, DbSession
from app.models import Counteragent, Order, OrderPosition, OrderStatus, OrderType, StatusGroup

router = APIRouter(prefix="/intake", tags=["Приёмка"])

REGULAR_FROM = 3  # визитов — «постоянный клиент»
REPEAT_WINDOW_DAYS = 90  # без сроков гарантии считаем повтором ремонт за последние 90 дней


def _norm_serial(value: str | None) -> str:
    return re.sub(r"[^0-9a-z]", "", (value or "").lower())


def _norm_model(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").lower()).strip()


def _day(value: datetime | None) -> date | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.date()


def _device(order: Order) -> str:
    return " ".join(p for p in [order.brand, order.model] if p) or order.device_type or "Устройство"


def client_summary(db, client: Counteragent) -> dict:
    base = select(Order).where(Order.counteragent_id == client.id, Order.is_deleted.is_(False))
    visits = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    open_orders = db.scalar(
        select(func.count(Order.id))
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(Order.counteragent_id == client.id, Order.is_deleted.is_(False), OrderStatus.group != StatusGroup.CLOSED)
    ) or 0
    last = db.scalars(base.order_by(Order.created_at.desc(), Order.id.desc()).limit(1)).first()
    last_info = None
    if last is not None:
        works = db.scalars(
            select(OrderPosition.name).where(OrderPosition.order_id == last.id).order_by(OrderPosition.is_work.desc(), OrderPosition.id)
        ).all()
        last_info = {
            "id": last.id,
            "number": last.number,
            "device": _device(last),
            "works": list(works[:3]),
            "date": last.created_at,
            "days_ago": (datetime.now(timezone.utc).date() - _day(last.created_at)).days,
        }
    spent = db.scalar(
        select(func.coalesce(func.sum(Order.total_price), 0)).where(
            Order.counteragent_id == client.id, Order.is_deleted.is_(False), Order.closed_at.is_not(None)
        )
    )
    return {
        "id": client.id,
        "name": client.name,
        "visits": visits,
        "is_regular": visits >= REGULAR_FROM,
        "open_orders": open_orders,
        "debt": max(0, -client.balance),
        "spent": spent or 0,
        "allow_sms": client.allow_sms,
        "note": client.note,
        "last": last_info,
    }


def warranty_matches(db, counteragent_id: int | None, serial: str | None, brand: str | None, model: str | None) -> list[dict]:
    serial_key = _norm_serial(serial)
    model_key = _norm_model(" ".join(p for p in [brand, model] if p))
    conditions = []
    if len(serial_key) >= 5:
        # IMEI бывает записан с пробелами и дефисами — убираем их и в базе. Грубый отбор, точное сравнение ниже
        stored = func.replace(func.replace(func.replace(func.lower(Order.serial), " ", ""), "-", ""), "/", "")
        conditions.append(stored.contains(serial_key[-8:]))
    if counteragent_id and model_key:
        conditions.append(Order.counteragent_id == counteragent_id)
    if not conditions:
        return []
    today = datetime.now(timezone.utc).date()
    candidates = db.scalars(
        select(Order)
        .where(Order.is_deleted.is_(False), Order.closed_at.is_not(None), or_(*conditions))
        .order_by(Order.closed_at.desc())
        .limit(30)
    ).all()

    result = []
    for order in candidates:
        by_serial = len(serial_key) >= 5 and _norm_serial(order.serial) == serial_key
        by_model = (
            bool(counteragent_id) and order.counteragent_id == counteragent_id
            and model_key and _norm_model(_device(order)) == model_key
        )
        if not (by_serial or by_model):
            continue
        closed = _day(order.closed_at)
        covered = [
            {"name": p.name, "until": closed + timedelta(days=p.guarantee_days)}
            for p in order.positions
            if p.guarantee_days > 0 and closed + timedelta(days=p.guarantee_days) >= today
        ]
        days_ago = (today - closed).days
        if covered:
            kind = "warranty"
        elif days_ago <= REPEAT_WINDOW_DAYS:
            kind = "repeat"
        else:
            continue
        result.append(
            {
                "kind": kind,
                "match": "serial" if by_serial else "model",
                "order_id": order.id,
                "number": order.number,
                "device": _device(order),
                "brand": order.brand,
                "model": order.model,
                "closed_at": order.closed_at,
                "days_ago": days_ago,
                "covered": sorted(covered, key=lambda c: c["until"], reverse=True),
                "works": [p.name for p in order.positions][:4],
            }
        )
    # Сначала настоящая гарантия, потом свежие повторы
    result.sort(key=lambda r: (r["kind"] != "warranty", r["days_ago"]))
    return result[:3]


@router.get("/hints")
def intake_hints(
    db: DbSession,
    me: CurrentEmployee,
    counteragent_id: int | None = None,
    serial: str | None = None,
    brand: str | None = None,
    model: str | None = None,
):
    require_order_read(me)
    client = db.get(Counteragent, counteragent_id) if counteragent_id else None
    if client is not None and client.is_deleted:
        client = None
    # Тип «Гарантийный» (но не «Негарантийный»). Сравнение в Python: lower() в SQLite не знает кириллицу
    warranty_type = next(
        (t for t in db.scalars(select(OrderType).where(OrderType.is_active.is_(True)).order_by(OrderType.sort))
         if t.name.strip().lower().startswith("гарантийн")),
        None,
    )
    return {
        "client": client_summary(db, client) if client else None,
        "warranty": warranty_matches(db, client.id if client else None, serial, brand, model),
        "warranty_order_type_id": warranty_type.id if warranty_type else None,
    }
