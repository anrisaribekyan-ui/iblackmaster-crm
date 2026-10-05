"""Главная: сводка по заказам, просрочкам, деньгам, источникам рекламы и мастерам.

Каждый блок отдаётся только при соответствующем праве, иначе null.
Период по умолчанию — сегодняшние сутки по Москве (Europe/Moscow), переведённые в UTC.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from sqlalchemy import func, or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids
from app.db import utcnow
from app.models import CashItem, CashItemType, CashRegister, Employee, HowKnow, Order, OrderStatus, StatusGroup, Transaction

router = APIRouter(prefix="/dashboard", tags=["Главная"])

MSK = ZoneInfo("Europe/Moscow")


def _day_bounds_msk() -> tuple[datetime, datetime]:
    now = datetime.now(MSK)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _ensure_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _orders_block(db: DbSession, me: CurrentEmployee, allowed: set[int], period_from: datetime, period_to: datetime) -> dict:
    def count(*filters):
        query = select(func.count()).select_from(Order).where(Order.is_deleted.is_(False), *filters)
        if allowed:
            query = query.where(Order.location_id.in_(allowed))
        return db.scalar(query) or 0

    created = count(Order.created_at >= period_from, Order.created_at < period_to)

    in_work = db.scalar(
        select(func.count())
        .select_from(Order)
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(Order.is_deleted.is_(False), OrderStatus.group != StatusGroup.CLOSED)
        .where(*([Order.location_id.in_(allowed)] if allowed else []))
    ) or 0

    ready = db.scalar(
        select(func.count())
        .select_from(Order)
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(Order.is_deleted.is_(False), OrderStatus.group == StatusGroup.FINISH)
        .where(*([Order.location_id.in_(allowed)] if allowed else []))
    ) or 0

    closed = None
    if has_permission(me, "dashboardOrderClosedAccess"):
        closed = count(Order.closed_at.is_not(None), Order.closed_at >= period_from, Order.closed_at < period_to)

    return {"created": created, "in_work": in_work, "ready": ready, "closed": closed}


def _overdue_block(db: DbSession, allowed: set[int]) -> list[dict]:
    query = (
        select(Order, OrderStatus)
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(
            Order.is_deleted.is_(False),
            Order.deadline.is_not(None),
            Order.deadline < utcnow(),
            OrderStatus.group != StatusGroup.CLOSED,
        )
    )
    if allowed:
        query = query.where(Order.location_id.in_(allowed))
    rows = db.execute(query.order_by(Order.deadline).limit(20)).all()
    result = []
    for order, status in rows:
        master = db.get(Employee, order.master_id) if order.master_id else None
        result.append(
            {
                "id": order.id,
                "number": order.number,
                "deadline": order.deadline,
                "status_name": status.name,
                "status_color": status.color,
                "master_name": master.short_name if master else None,
            }
        )
    return result


def _finance_block(db: DbSession, allowed: set[int], period_from: datetime, period_to: datetime) -> dict:
    register_query = select(CashRegister).where(CashRegister.is_active.is_(True))
    if allowed:
        register_query = register_query.where(or_(CashRegister.location_id.is_(None), CashRegister.location_id.in_(allowed)))
    registers = db.scalars(register_query.order_by(CashRegister.name)).all()

    transaction_query = select(Transaction).where(
        Transaction.is_deleted.is_(False),
        Transaction.date >= period_from,
        Transaction.date < period_to,
    )
    if allowed:
        transaction_query = transaction_query.where(or_(Transaction.location_id.is_(None), Transaction.location_id.in_(allowed)))
    transactions = db.scalars(transaction_query).all()

    income = sum(
        (t.amount for t in transactions if t.is_income and (t.order_id is not None or t.sale_id is not None)),
        Decimal("0"),
    )
    # Перемещения между кассами и инкассация — не расход бизнеса
    internal = set(
        db.scalars(
            select(CashItem.id).where(
                CashItem.type.in_([CashItemType.MOVE_FROM, CashItemType.PRODUCT_MOVE_FROM, CashItemType.COLLECTION])
            )
        )
    )
    expense = sum((t.amount for t in transactions if not t.is_income and t.cash_item_id not in internal), Decimal("0"))

    return {
        "income": income,
        "expense": expense,
        "cash_registers": [
            {"id": r.id, "name": r.name, "cash_balance": r.cash_balance, "bank_balance": r.bank_balance}
            for r in registers
        ],
    }


def _how_know_block(db: DbSession, allowed: set[int], period_from: datetime, period_to: datetime) -> list[dict]:
    query = (
        select(Order.how_know_id, func.count())
        .where(
            Order.is_deleted.is_(False),
            Order.how_know_id.is_not(None),
            Order.created_at >= period_from,
            Order.created_at < period_to,
        )
    )
    if allowed:
        query = query.where(Order.location_id.in_(allowed))
    rows = db.execute(query.group_by(Order.how_know_id).order_by(func.count().desc())).all()
    result = []
    for how_know_id, count in rows:
        how_know = db.get(HowKnow, how_know_id)
        result.append({"name": how_know.name if how_know else "—", "count": count})
    return result


def _masters_block(db: DbSession, allowed: set[int]) -> list[dict]:
    query = (
        select(Order.master_id, func.count())
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(
            Order.is_deleted.is_(False),
            OrderStatus.group != StatusGroup.CLOSED,
            Order.master_id.is_not(None),
        )
    )
    if allowed:
        query = query.where(Order.location_id.in_(allowed))
    rows = db.execute(query.group_by(Order.master_id).order_by(func.count().desc())).all()
    result = []
    for master_id, count in rows:
        master = db.get(Employee, master_id)
        result.append({"employee_id": master_id, "name": master.short_name if master else "—", "orders_in_work": count})
    return result


@router.get("")
def get_dashboard(
    db: DbSession,
    me: CurrentEmployee,
    location_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    allowed = location_ids(me)
    if location_id is not None:
        check_location(me, location_id)
        allowed = {location_id}

    default_from, default_to = _day_bounds_msk()
    period_from = _ensure_utc(date_from) if date_from is not None else default_from
    period_to = _ensure_utc(date_to) if date_to is not None else default_to

    orders_from, orders_to = period_from, period_to
    if not has_permission(me, "dashboardOrderPeriodAccess"):
        orders_from, orders_to = _day_bounds_msk()

    return {
        "orders": _orders_block(db, me, allowed, orders_from, orders_to),
        "overdue": _overdue_block(db, allowed) if has_permission(me, "dashboardDeadlineAccess") else None,
        "finance": _finance_block(db, allowed, period_from, period_to) if has_permission(me, "dashboardFinanceAccess") else None,
        "how_know": _how_know_block(db, allowed, period_from, period_to) if has_permission(me, "dashboardHowKnowAccess") else None,
        "masters": _masters_block(db, allowed),
    }

