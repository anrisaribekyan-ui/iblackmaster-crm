"""Забытые аппараты (ТЗ этап 3, E1): готовы, но клиент не забирает.

ready_since — когда заказ последний раз перешёл в текущий «готовый» статус (по истории),
для перенесённых из LiveSklad заказов без истории — дата готовности (finished_at).
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Counteragent, Notification, Order, OrderHistory, OrderStatus, StatusGroup
from app.services import notifications, settings

REMINDER_HOURS = (10, 20)  # SMS-напоминания только днём по Москве
MSK = timezone(timedelta(hours=3))


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def ready_orders(
    db: Session,
    allowed_locations: set[int] | None = None,
    location_id: int | None = None,
    own_employee_id: int | None = None,
) -> list[dict]:
    """Все заказы в «готовых» статусах с числом дней ожидания, самые давние сверху."""
    query = (
        select(Order, OrderStatus, Counteragent)
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .join(Counteragent, Counteragent.id == Order.counteragent_id)
        .where(OrderStatus.group == StatusGroup.FINISH, Order.is_deleted.is_(False))
    )
    if allowed_locations:
        query = query.where(Order.location_id.in_(allowed_locations))
    if location_id is not None:
        query = query.where(Order.location_id == location_id)
    if own_employee_id is not None:  # право «только свои заказы»
        query = query.where(
            (Order.master_id == own_employee_id) | (Order.manager_id == own_employee_id) | (Order.created_by_id == own_employee_id)
        )
    rows = db.execute(query).all()
    if not rows:
        return []
    # С какого момента заказ непрерывно в «готовых» статусах: переход «Готов (позвонить)» → «Готов и уведомлен»
    # счётчик не сбрасывает, а возврат в работу — сбрасывает. Одним запросом по всем заказам.
    finish_ids = set(db.scalars(select(OrderStatus.id).where(OrderStatus.group == StatusGroup.FINISH)))
    history: dict[int, list] = {}
    for order_id, status_id, created in db.execute(
        select(OrderHistory.order_id, OrderHistory.status_id, OrderHistory.created_at)
        .where(OrderHistory.order_id.in_([o.id for o, _, _ in rows]), OrderHistory.type == "status")
        .order_by(OrderHistory.created_at)
    ):
        history.setdefault(order_id, []).append((status_id, created))
    last_status = {}
    for order_id, events in history.items():
        since = None
        for status_id, created in reversed(events):
            if status_id not in finish_ids:
                break
            since = created
        if since is not None:
            last_status[order_id] = since
    reminded = {}
    for order_id, kind, sent in db.execute(
        select(Notification.order_id, Notification.kind, Notification.created_at).where(
            Notification.order_id.in_([o.id for o, _, _ in rows]), Notification.kind.like("remind%")
        )
    ):
        if order_id not in reminded or _utc(sent) > reminded[order_id]:
            reminded[order_id] = _utc(sent)

    now = utcnow()
    result = []
    for order, status, client in rows:
        since = _utc(last_status.get(order.id)) or _utc(order.finished_at) or _utc(order.last_action_at)
        days = max(0, (now - since).days) if since else 0
        result.append(
            {
                "id": order.id,
                "number": order.number,
                "location_id": order.location_id,
                "status": status.name,
                "status_color": status.color,
                "device": " ".join(p for p in [order.brand, order.model] if p) or order.device_type or "Устройство",
                "client": client.name,
                "phones": client.phones,
                "ready_since": since,
                "days": days,
                "total": order.total_price,
                "debt": max(Decimal("0"), order.total_price - order.paid),
                "last_reminder": reminded.get(order.id),
            }
        )
    result.sort(key=lambda r: r["days"], reverse=True)
    return result


def summary(db: Session, allowed_locations: set[int] | None = None, location_id: int | None = None, own_employee_id: int | None = None) -> dict:
    conf = settings.get(db, "forgotten")
    items = [r for r in ready_orders(db, allowed_locations, location_id, own_employee_id) if r["days"] >= conf["list_days"]]
    return {"days": conf["list_days"], "count": len(items), "debt": sum((r["debt"] for r in items), Decimal("0"))}


def queue_reminders(db: Session, now: datetime | None = None) -> int:
    """Ставит в очередь SMS-напоминания. Вызывается фоновым потоком; днём, не чаще раза в час.

    Каждому заказу — не больше одного напоминания на каждый порог (3, 7, 30 дней). Если заказ лежит
    давно и напоминания только включили — уходит одно, по самому большому достигнутому порогу.
    """
    conf = settings.get(db, "forgotten")
    if not conf["reminders_active"] or not conf["reminder_text"].strip():
        return 0
    now = now or utcnow()
    if not REMINDER_HOURS[0] <= now.astimezone(MSK).hour < REMINDER_HOURS[1]:
        return 0
    thresholds = sorted({int(d) for d in conf["reminder_days"] if int(d) > 0})
    if not thresholds:
        return 0
    queued = 0
    for row in ready_orders(db):
        reached = [d for d in thresholds if row["days"] >= d]
        if not reached:
            continue
        kind = f"remind{reached[-1]}"
        exists = db.scalar(select(Notification.id).where(Notification.order_id == row["id"], Notification.kind == kind))
        if exists:
            continue
        order = db.get(Order, row["id"])
        if notifications.enqueue_text(db, order, conf["reminder_text"], kind=kind, extra={"{дней}": str(row["days"])}):
            queued += 1
    return queued
