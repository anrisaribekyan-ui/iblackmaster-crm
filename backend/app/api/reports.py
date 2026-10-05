"""Отчёты (Аналитика). Все эндпоинты требуют право reportAccess.

Параметры: date_from/date_to (UTC ISO, обязательны), location_id (необязателен).
День группировки day — «YYYY-MM-DD» по Москве.
"""

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require
from app.models import (
    CashItem,
    CashRegister,
    Employee,
    HowKnow,
    Nomenclature,
    Order,
    OrderPosition,
    OrderStatus,
    OrderType,
    Sale,
    SalePosition,
    StockBalance,
    Store,
    Transaction,
)

router = APIRouter(prefix="/reports", tags=["Аналитика"])

MSK = ZoneInfo("Europe/Moscow")


def _ensure_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _money(value) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _moscow_day(value: datetime) -> str:
    return value.astimezone(MSK).strftime("%Y-%m-%d")


def _allowed(db: DbSession, me: CurrentEmployee, location_id: int | None) -> set[int]:
    allowed = location_ids(me)
    if location_id is not None:
        check_location(me, location_id)
        allowed = {location_id}
    return allowed


def _name_or(db: DbSession, employee_id: int | None, default: str) -> str:
    if employee_id is None:
        return default
    employee = db.get(Employee, employee_id)
    return employee.short_name if employee else default


def _with_margin(item: dict, can_margin: bool) -> dict:
    if can_margin:
        cost = _money(item["cost"])
        return {**item, "cost": cost, "profit": _money(item["revenue"] - item["cost"])}
    return {**item, "cost": None, "profit": None}


@router.get("/orders", dependencies=[Depends(require("reportAccess"))])
def report_orders(
    db: DbSession,
    me: CurrentEmployee,
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    location_id: int | None = None,
    group_by: str = "master",
):
    allowed = _allowed(db, me, location_id)
    period_from = _ensure_utc(date_from)
    period_to = _ensure_utc(date_to)

    query = select(Order).where(
        Order.is_deleted.is_(False),
        Order.closed_at.is_not(None),
        Order.closed_at >= period_from,
        Order.closed_at < period_to,
    )
    if allowed:
        query = query.where(Order.location_id.in_(allowed))
    orders = db.scalars(query.order_by(Order.closed_at)).all()

    can_margin = has_permission(me, "marginPriceAccess")
    groups: dict[str, dict] = {}
    for order in orders:
        if group_by == "manager":
            key = f"m:{order.manager_id}"
            name = _name_or(db, order.manager_id, "—")
        elif group_by == "order_type":
            key = f"t:{order.order_type_id}"
            order_type = db.get(OrderType, order.order_type_id) if order.order_type_id else None
            name = order_type.name if order_type else "—"
        elif group_by == "status":
            key = f"s:{order.status_id}"
            status = db.get(OrderStatus, order.status_id)
            name = status.name if status else "—"
        elif group_by == "how_know":
            key = f"h:{order.how_know_id}"
            how_know = db.get(HowKnow, order.how_know_id) if order.how_know_id else None
            name = how_know.name if how_know else "—"
        elif group_by == "day":
            key = _moscow_day(order.closed_at)
            name = key
        else:
            key = f"m:{order.master_id}"
            name = _name_or(db, order.master_id, "—")

        item = groups.setdefault(key, {"key": key, "name": name, "count": 0, "revenue": Decimal("0"), "cost": Decimal("0")})
        item["count"] += 1
        item["revenue"] += order.total_price
        item["cost"] += order.total_purchase

    return [
        _with_margin(
            {"key": item["key"], "name": item["name"], "count": item["count"], "revenue": _money(item["revenue"]), "cost": item["cost"]},
            can_margin,
        )
        for item in groups.values()
    ]


@router.get("/works", dependencies=[Depends(require("reportAccess"))])
def report_works(
    db: DbSession,
    me: CurrentEmployee,
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    location_id: int | None = None,
    group_by: str = "performer",
    is_work: bool = True,
):
    allowed = _allowed(db, me, location_id)
    period_from = _ensure_utc(date_from)
    period_to = _ensure_utc(date_to)

    query = (
        select(OrderPosition)
        .join(Order, Order.id == OrderPosition.order_id)
        .where(
            Order.is_deleted.is_(False),
            Order.closed_at.is_not(None),
            Order.closed_at >= period_from,
            Order.closed_at < period_to,
            OrderPosition.is_work.is_(is_work),
        )
    )
    if allowed:
        query = query.where(Order.location_id.in_(allowed))
    positions = db.scalars(query).all()

    can_margin = has_permission(me, "marginPriceAccess")
    groups: dict[str, dict] = {}
    for position in positions:
        if group_by == "nomenclature":
            key = f"n:{position.nomenclature_id}"
            nomenclature = db.get(Nomenclature, position.nomenclature_id) if position.nomenclature_id else None
            name = nomenclature.name if nomenclature else position.name
        else:
            key = f"p:{position.performer_id}"
            name = _name_or(db, position.performer_id, "—")

        item = groups.setdefault(key, {"key": key, "name": name, "quantity": Decimal("0"), "revenue": Decimal("0"), "cost": Decimal("0")})
        item["quantity"] += position.quantity
        item["revenue"] += position.sold_price * position.quantity
        item["cost"] += position.purchase_price * position.quantity

    return [
        _with_margin(
            {"key": item["key"], "name": item["name"], "quantity": _money(item["quantity"]), "revenue": _money(item["revenue"]), "cost": item["cost"]},
            can_margin,
        )
        for item in groups.values()
    ]


@router.get("/sales", dependencies=[Depends(require("reportAccess"))])
def report_sales(
    db: DbSession,
    me: CurrentEmployee,
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    location_id: int | None = None,
    group_by: str = "seller",
):
    allowed = _allowed(db, me, location_id)
    period_from = _ensure_utc(date_from)
    period_to = _ensure_utc(date_to)

    query = select(Sale).where(
        Sale.is_deleted.is_(False),
        Sale.date >= period_from,
        Sale.date < period_to,
    )
    if allowed:
        query = query.where(Sale.location_id.in_(allowed))
    sales = db.scalars(query.order_by(Sale.date)).all()

    can_margin = has_permission(me, "marginPriceAccess")
    groups: dict[str, dict] = {}
    if group_by == "nomenclature":
        sale_ids = [sale.id for sale in sales]
        if sale_ids:
            positions = db.scalars(select(SalePosition).where(SalePosition.sale_id.in_(sale_ids))).all()
        else:
            positions = []
        for position in positions:
            key = f"n:{position.nomenclature_id}"
            nomenclature = db.get(Nomenclature, position.nomenclature_id) if position.nomenclature_id else None
            name = nomenclature.name if nomenclature else position.name
            item = groups.setdefault(key, {"key": key, "name": name, "count": 0, "revenue": Decimal("0"), "cost": Decimal("0")})
            item["count"] += 1
            item["revenue"] += position.sold_price * position.quantity
            item["cost"] += position.purchase_price * position.quantity
    else:
        for sale in sales:
            if group_by == "day":
                key = _moscow_day(sale.date)
                name = key
            else:
                key = f"s:{sale.seller_id}"
                name = _name_or(db, sale.seller_id, "—")
            item = groups.setdefault(key, {"key": key, "name": name, "count": 0, "revenue": Decimal("0"), "cost": Decimal("0")})
            item["count"] += 1
            item["revenue"] += sale.total_price
            item["cost"] += sale.total_purchase

    return [
        _with_margin(
            {"key": item["key"], "name": item["name"], "count": item["count"], "revenue": _money(item["revenue"]), "cost": item["cost"]},
            can_margin,
        )
        for item in groups.values()
    ]


@router.get("/cashflow", dependencies=[Depends(require("reportAccess"))])
def report_cashflow(
    db: DbSession,
    me: CurrentEmployee,
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    location_id: int | None = None,
    group_by: str = "cash_item",
):
    allowed = _allowed(db, me, location_id)
    period_from = _ensure_utc(date_from)
    period_to = _ensure_utc(date_to)

    query = select(Transaction).where(
        Transaction.is_deleted.is_(False),
        Transaction.date >= period_from,
        Transaction.date < period_to,
    )
    if allowed:
        query = query.where(or_(Transaction.location_id.is_(None), Transaction.location_id.in_(allowed)))
    transactions = db.scalars(query).all()

    groups: dict[str, dict] = {}
    for tx in transactions:
        if group_by == "cash_register":
            key = f"r:{tx.cash_register_id}"
            register = db.get(CashRegister, tx.cash_register_id)
            name = register.name if register else "—"
        elif group_by == "day":
            key = _moscow_day(tx.date)
            name = key
        else:
            key = f"i:{tx.cash_item_id}"
            item = db.get(CashItem, tx.cash_item_id)
            name = item.name if item else "—"

        row = groups.setdefault(key, {"key": key, "name": name, "income": Decimal("0"), "expense": Decimal("0")})
        if tx.is_income:
            row["income"] += tx.amount
        else:
            row["expense"] += tx.amount

    return [
        {"key": item["key"], "name": item["name"], "income": _money(item["income"]), "expense": _money(item["expense"])}
        for item in groups.values()
    ]


@router.get("/stock-value", dependencies=[Depends(require("reportAccess"))])
def report_stock_value(
    db: DbSession,
    me: CurrentEmployee,
    location_id: int | None = None,
):
    allowed = _allowed(db, me, location_id)
    query = (
        select(StockBalance, Store)
        .join(Store, Store.id == StockBalance.store_id)
        .where(Store.is_active.is_(True))
    )
    if allowed:
        query = query.where(Store.location_id.in_(allowed))
    rows = db.execute(query.order_by(Store.id)).all()

    can_view_purchase = has_permission(me, "purchasePriceAccess")
    groups: dict[int, dict] = {}
    for balance, store in rows:
        item = groups.setdefault(
            store.id,
            {"store_id": store.id, "store_name": store.name, "positions": 0, "quantity": Decimal("0"), "value": Decimal("0")},
        )
        item["positions"] += 1
        item["quantity"] += balance.quantity
        item["value"] += balance.quantity * balance.avg_purchase_price

    result = []
    for item in groups.values():
        result.append(
            {
                "store_id": item["store_id"],
                "store_name": item["store_name"],
                "positions": item["positions"],
                "quantity": _money(item["quantity"]),
                "value": _money(item["value"]) if can_view_purchase else None,
            }
        )
    return result

