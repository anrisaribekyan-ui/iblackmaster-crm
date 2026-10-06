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


def _msk_day(value: datetime) -> str:
    return _ensure_utc(value).astimezone(MSK).strftime("%Y-%m-%d")


def _trend_block(db: DbSession, me: CurrentEmployee, allowed: set[int], days: int = 30) -> list[dict]:
    """Динамика за последние N дней по Москве: заказы создано/выдано, приход/расход по дням."""
    _, today_end = _day_bounds_msk()
    start = today_end - timedelta(days=days)
    keys = [(start + timedelta(days=i, hours=3)).astimezone(MSK).strftime("%Y-%m-%d") for i in range(days)]
    rows = {k: {"day": k, "created": 0, "closed": None, "income": None, "expense": None} for k in keys}
    can_closed = has_permission(me, "dashboardOrderClosedAccess")
    can_money = has_permission(me, "dashboardFinanceAccess")
    for row in rows.values():
        if can_closed:
            row["closed"] = 0
        if can_money:
            row["income"] = Decimal("0")
            row["expense"] = Decimal("0")

    location_filter = [Order.location_id.in_(allowed)] if allowed else []
    for (created_at,) in db.execute(
        select(Order.created_at).where(Order.is_deleted.is_(False), Order.created_at >= start, Order.created_at < today_end, *location_filter)
    ):
        key = _msk_day(created_at)
        if key in rows:
            rows[key]["created"] += 1
    if can_closed:
        for (closed_at,) in db.execute(
            select(Order.closed_at).where(Order.is_deleted.is_(False), Order.closed_at >= start, Order.closed_at < today_end, *location_filter)
        ):
            key = _msk_day(closed_at)
            if key in rows:
                rows[key]["closed"] += 1
    if can_money:
        internal = set(
            db.scalars(
                select(CashItem.id).where(
                    CashItem.type.in_([CashItemType.MOVE_FROM, CashItemType.PRODUCT_MOVE_FROM, CashItemType.COLLECTION])
                )
            )
        )
        query = select(Transaction).where(Transaction.is_deleted.is_(False), Transaction.date >= start, Transaction.date < today_end)
        if allowed:
            query = query.where(or_(Transaction.location_id.is_(None), Transaction.location_id.in_(allowed)))
        for tx in db.scalars(query):
            key = _msk_day(tx.date)
            if key not in rows:
                continue
            if tx.is_income and (tx.order_id is not None or tx.sale_id is not None):
                rows[key]["income"] += tx.amount
            elif not tx.is_income and tx.cash_item_id not in internal:
                rows[key]["expense"] += tx.amount
    return list(rows.values())


def _previous_block(db: DbSession, me: CurrentEmployee, allowed: set[int], period_from: datetime, period_to: datetime) -> dict:
    """Те же показатели за предыдущий период такой же длины — для «+12% к прошлому периоду» на плитках."""
    length = period_to - period_from
    prev_from, prev_to = period_from - length, period_from
    location_filter = [Order.location_id.in_(allowed)] if allowed else []
    created = db.scalar(
        select(func.count()).select_from(Order).where(
            Order.is_deleted.is_(False), Order.created_at >= prev_from, Order.created_at < prev_to, *location_filter
        )
    ) or 0
    closed = None
    if has_permission(me, "dashboardOrderClosedAccess"):
        closed = db.scalar(
            select(func.count()).select_from(Order).where(
                Order.is_deleted.is_(False), Order.closed_at >= prev_from, Order.closed_at < prev_to, *location_filter
            )
        ) or 0
    income = None
    if has_permission(me, "dashboardFinanceAccess"):
        income = _finance_block(db, allowed, prev_from, prev_to)["income"]
    return {"created": created, "closed": closed, "income": income}


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
        "trend": _trend_block(db, me, allowed),
        "previous": _previous_block(db, me, allowed, orders_from, orders_to),
    }

