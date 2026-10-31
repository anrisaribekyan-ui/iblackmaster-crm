"""Отчёты (Аналитика). Все эндпоинты требуют право reportAccess.

Параметры: date_from/date_to (UTC ISO, обязательны), location_id (необязателен).
День группировки day — «YYYY-MM-DD» по Москве.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require
from app.errors import Forbidden
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
    SalaryEvent,
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


def _employee_names(db: DbSession) -> dict[int, str]:
    """Имена сотрудников одним запросом — иначе отчёт делает запрос на каждую строку."""
    return dict(db.execute(select(Employee.id, Employee.short_name)).all())


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
    employee_names = _employee_names(db) if group_by not in ("order_type", "status", "how_know", "day") else {}
    order_types = (
        dict(db.execute(select(OrderType.id, OrderType.name)).all()) if group_by == "order_type" else {}
    )
    status_names = dict(db.execute(select(OrderStatus.id, OrderStatus.name)).all()) if group_by == "status" else {}
    how_knows = dict(db.execute(select(HowKnow.id, HowKnow.name)).all()) if group_by == "how_know" else {}
    groups: dict[str, dict] = {}
    for order in orders:
        if group_by == "manager":
            key = f"m:{order.manager_id}"
            name = employee_names.get(order.manager_id, "—")
        elif group_by == "order_type":
            key = f"t:{order.order_type_id}"
            name = order_types.get(order.order_type_id, "—")
        elif group_by == "status":
            key = f"s:{order.status_id}"
            name = status_names.get(order.status_id, "—")
        elif group_by == "how_know":
            key = f"h:{order.how_know_id}"
            name = how_knows.get(order.how_know_id, "—") if order.how_know_id else "—"
        elif group_by == "day":
            key = _moscow_day(order.closed_at)
            name = key
        else:
            key = f"m:{order.master_id}"
            name = employee_names.get(order.master_id, "—")

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
    employee_names = _employee_names(db) if group_by != "nomenclature" else {}
    nomenclatures = (
        dict(db.execute(select(Nomenclature.id, Nomenclature.name)).all()) if group_by == "nomenclature" else {}
    )
    groups: dict[str, dict] = {}
    for position in positions:
        if group_by == "nomenclature":
            key = f"n:{position.nomenclature_id}"
            name = nomenclatures.get(position.nomenclature_id, position.name) if position.nomenclature_id else position.name
        else:
            key = f"p:{position.performer_id}"
            name = employee_names.get(position.performer_id, "—")

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
        nomenclatures = dict(db.execute(select(Nomenclature.id, Nomenclature.name)).all())
        for position in positions:
            key = f"n:{position.nomenclature_id}"
            name = nomenclatures.get(position.nomenclature_id, position.name) if position.nomenclature_id else position.name
            item = groups.setdefault(key, {"key": key, "name": name, "count": 0, "revenue": Decimal("0"), "cost": Decimal("0")})
            item["count"] += 1
            item["revenue"] += position.sold_price * position.quantity
            item["cost"] += position.purchase_price * position.quantity
    else:
        employee_names = _employee_names(db) if group_by != "day" else {}
        for sale in sales:
            if group_by == "day":
                key = _moscow_day(sale.date)
                name = key
            else:
                key = f"s:{sale.seller_id}"
                name = employee_names.get(sale.seller_id, "—")
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

    registers = dict(db.execute(select(CashRegister.id, CashRegister.name)).all()) if group_by == "cash_register" else {}
    cash_items = dict(db.execute(select(CashItem.id, CashItem.name)).all()) if group_by not in ("cash_register", "day") else {}
    groups: dict[str, dict] = {}
    for tx in transactions:
        if group_by == "cash_register":
            key = f"r:{tx.cash_register_id}"
            name = registers.get(tx.cash_register_id, "—")
        elif group_by == "day":
            key = _moscow_day(tx.date)
            name = key
        else:
            key = f"i:{tx.cash_item_id}"
            name = cash_items.get(tx.cash_item_id, "—")

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
        .where(Store.is_active.is_(True), StockBalance.quantity > 0)
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



# --- Прибыль: валовая и чистая по периодам --------------------------------------------------

# Не расходы бизнеса: перемещения денег, инкассация, закупка товара (она в себестоимости, когда товар
# продан/установлен), выплата зарплаты (зарплату берём по начислениям), возвраты клиентам (это не затраты).
NOT_EXPENSE_TYPES = {
    "move", "productMoveFrom", "collection", "purchase", "salary", "orderReturn", "saleReturn", "bankPercent",
}
# Выдачи учредителю/работнику — это движение денег владельца и подотчёт, а не расход.
# «Корректировка остатка» — служебная проводка переноса из LiveSklad, «инкассац»/«перемещ» — движение денег между кассами
NOT_EXPENSE_NAMES = ("учредител", "работник", "корректировка остатка", "инкассац", "перемещ")


def _bucket(value: datetime, group_by: str) -> str:
    day = value.astimezone(MSK).date()
    if group_by == "month":
        return day.replace(day=1).isoformat()
    if group_by == "week":
        return (day - timedelta(days=day.weekday())).isoformat()  # понедельник недели
    return day.isoformat()


@router.get("/profit", dependencies=[Depends(require("reportAccess"))])
def report_profit(
    db: DbSession,
    me: CurrentEmployee,
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    location_id: int | None = None,
    group_by: Literal["day", "week", "month"] = "day",
):
    """Выручка (выданные заказы + чеки) → валовая прибыль (минус себестоимость) → чистая прибыль
    (минус начисленная зарплата, комиссия банка и расходы по кассам)."""
    if not has_permission(me, "marginPriceAccess"):
        raise Forbidden("Нет права видеть себестоимость и прибыль")
    allowed = _allowed(db, me, location_id)
    period_from = _ensure_utc(date_from)
    period_to = _ensure_utc(date_to)

    empty = lambda: {k: Decimal("0") for k in ("revenue", "cost", "salary", "bank_fee", "expenses")} | {"orders": 0, "sales": 0}
    buckets: dict[str, dict] = defaultdict(empty)

    order_query = select(Order.closed_at, Order.total_price, Order.total_purchase).where(
        Order.is_deleted.is_(False), Order.closed_at >= period_from, Order.closed_at < period_to
    )
    if allowed:
        order_query = order_query.where(Order.location_id.in_(allowed))
    for closed_at, total, cost in db.execute(order_query):
        b = buckets[_bucket(closed_at, group_by)]
        b["revenue"] += total
        b["cost"] += cost
        b["orders"] += 1

    sale_query = select(Sale.date, Sale.total_price, Sale.total_purchase).where(
        Sale.is_deleted.is_(False), Sale.date >= period_from, Sale.date < period_to
    )
    if allowed:
        sale_query = sale_query.where(Sale.location_id.in_(allowed))
    for date_, total, cost in db.execute(sale_query):
        b = buckets[_bucket(date_, group_by)]
        b["revenue"] += total
        b["cost"] += cost
        b["sales"] += 1

    salary_query = select(SalaryEvent.date, SalaryEvent.amount).where(SalaryEvent.date >= period_from, SalaryEvent.date < period_to)
    if location_id is not None:
        salary_query = salary_query.where(SalaryEvent.location_id == location_id)
    elif allowed:
        salary_query = salary_query.where(or_(SalaryEvent.location_id.is_(None), SalaryEvent.location_id.in_(allowed)))
    for date_, amount in db.execute(salary_query):
        buckets[_bucket(date_, group_by)]["salary"] += amount

    tx_query = (
        select(Transaction.date, Transaction.amount, CashItem.name, CashItem.type)
        .join(CashItem, CashItem.id == Transaction.cash_item_id)
        .where(
            Transaction.is_deleted.is_(False),
            Transaction.is_income.is_(False),
            Transaction.date >= period_from,
            Transaction.date < period_to,
        )
    )
    # По одной точке — только её расходы; общие (без точки) видны в отчёте по всем точкам
    if location_id is not None:
        tx_query = tx_query.where(Transaction.location_id == location_id)
    elif allowed:
        tx_query = tx_query.where(or_(Transaction.location_id.is_(None), Transaction.location_id.in_(allowed)))
    expense_items: dict[str, Decimal] = defaultdict(Decimal)
    skipped_items: dict[str, Decimal] = defaultdict(Decimal)
    for date_, amount, name, type_ in db.execute(tx_query):
        b = buckets[_bucket(date_, group_by)]
        if type_ == "bankPercent":
            b["bank_fee"] += amount
        elif type_ in NOT_EXPENSE_TYPES or any(word in name.lower() for word in NOT_EXPENSE_NAMES):
            skipped_items[name] += amount
        else:
            b["expenses"] += amount
            expense_items[name] += amount

    def finish(key: str, b: dict) -> dict:
        gross = b["revenue"] - b["cost"]
        net = gross - b["salary"] - b["bank_fee"] - b["expenses"]
        return {
            "key": key,
            "orders": b["orders"],
            "sales": b["sales"],
            "revenue": _money(b["revenue"]),
            "cost": _money(b["cost"]),
            "gross": _money(gross),
            "salary": _money(b["salary"]),
            "bank_fee": _money(b["bank_fee"]),
            "expenses": _money(b["expenses"]),
            "net": _money(net),
            "margin": round(float(net / b["revenue"] * 100), 1) if b["revenue"] else None,
        }

    rows = [finish(key, buckets[key]) for key in sorted(buckets)]
    total = empty()
    for b in buckets.values():
        for k in total:
            total[k] += b[k]
    return {
        "group_by": group_by,
        "rows": rows,
        "total": finish("total", total),
        "expense_items": sorted(({"name": n, "amount": _money(a)} for n, a in expense_items.items()), key=lambda x: -x["amount"]),
        "not_counted": sorted(({"name": n, "amount": _money(a)} for n, a in skipped_items.items()), key=lambda x: -x["amount"]),
    }
