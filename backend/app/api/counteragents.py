from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from app.api.deps import CurrentEmployee, DbSession, has_permission, location_ids, require, scope_of
from app.errors import Forbidden, NotFound
from app.models import CashItem, Counteragent, CounteragentType, Employee, HowKnow, Order, OrderStatus, Sale, Transaction
from app.utils.phone import normalize_phone

router = APIRouter(prefix="/counteragents", tags=["Контрагенты"])


class CounteragentIn(BaseModel):
    type_id: int | None = None
    name: str = Field(min_length=1, max_length=300)
    phones: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    telegram: str | None = Field(default=None, max_length=100)
    max_messenger: str | None = Field(default=None, max_length=100)
    inn: str | None = Field(default=None, max_length=20)
    note: str | None = None
    how_know_id: int | None = None
    manager_id: int | None = None
    is_buyer: bool = True
    is_vendor: bool = False
    rating: int = 0
    allow_sms: bool = True
    allow_email: bool = True
    allow_telegram: bool = True
    allow_max: bool = True
    extra: dict = Field(default_factory=dict)


class CounteragentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type_id: int | None
    name: str
    phones: str | None
    email: str | None
    address: str | None
    telegram: str | None
    max_messenger: str | None
    inn: str | None
    note: str | None
    how_know_id: int | None
    manager_id: int | None
    is_buyer: bool
    is_vendor: bool
    rating: int
    allow_sms: bool
    allow_email: bool
    allow_telegram: bool
    allow_max: bool
    extra: dict
    balance: Decimal


class CounteragentDetail(CounteragentOut):
    orders_count: int


class CounteragentPage(BaseModel):
    items: list[CounteragentOut]
    total: int
    page: int


def require_order_read(employee: CurrentEmployee) -> None:
    if scope_of(employee, "orders") == "none":
        raise Forbidden("Нет доступа к заказам")


def normalize_phones(phones: str | None) -> str | None:
    if not phones:
        return None
    normalized = []
    for raw_phone in phones.split(","):
        digits = normalize_phone(raw_phone)
        if digits and digits not in normalized:
            normalized.append(digits)
    return ",".join(normalized) or None


def validate_references(db: DbSession, data: CounteragentIn) -> None:
    if data.type_id is not None and db.get(CounteragentType, data.type_id) is None:
        raise NotFound("Тип контрагента")
    if data.how_know_id is not None and db.get(HowKnow, data.how_know_id) is None:
        raise NotFound("Рекламный источник")
    if data.manager_id is not None and db.get(Employee, data.manager_id) is None:
        raise NotFound("Менеджер")


def phones_match(counteragent: Counteragent, normalized: str) -> bool:
    return any(phone.strip() == normalized for phone in (counteragent.phones or "").split(","))


def visible_query(me: CurrentEmployee, is_vendor: bool | None = None):
    """Запрос «какие контрагенты видны сотруднику» — фильтры и страницы дальше добавляет база, не Python."""
    require_order_read(me)
    query = select(Counteragent).where(Counteragent.is_deleted.is_(False))
    can_view_vendors = has_permission(me, "counteragentSellerAccess")
    if is_vendor is not None:
        if is_vendor and not can_view_vendors:
            return None
        query = query.where(Counteragent.is_vendor.is_(is_vendor))
    elif not can_view_vendors:
        query = query.where(Counteragent.is_vendor.is_(False))
    return query


def visible_counteragents(db: DbSession, me: CurrentEmployee, is_vendor: bool | None = None):
    query = visible_query(me, is_vendor)
    return [] if query is None else db.scalars(query.order_by(Counteragent.name, Counteragent.id)).all()


@router.get("", response_model=CounteragentPage)
def list_counteragents(
    db: DbSession,
    me: CurrentEmployee,
    q: str | None = None,
    is_vendor: bool | None = None,
    page: int = Query(default=1, ge=1),
):
    query = visible_query(me, is_vendor)
    if query is None:
        return CounteragentPage(items=[], total=0, page=page)
    if q and q.strip():
        normalized = normalize_phone(q)
        raw_digits = "".join(char for char in q if char.isdecimal())
        if normalized:
            query = query.where(Counteragent.phones.contains(normalized, autoescape=True))
        elif len(raw_digits) >= 3:
            query = query.where(Counteragent.phones.contains(raw_digits, autoescape=True))
        else:
            query = query.where(Counteragent.name.icontains(q.strip(), autoescape=True))
    total = db.scalar(query.with_only_columns(func.count(Counteragent.id))) or 0
    items = db.scalars(query.order_by(Counteragent.name, Counteragent.id).offset((page - 1) * 50).limit(50)).all()
    if q and normalize_phone(q):  # «содержит» в базе, точное совпадение номера — здесь
        items = [item for item in items if phones_match(item, normalize_phone(q))]
    return CounteragentPage(items=items, total=total, page=page)


@router.get("/by-phone", response_model=CounteragentOut | None)
def counteragent_by_phone(phone: str, db: DbSession, me: CurrentEmployee):
    """Вызывается на приёмке при наборе номера — ищем в базе, а не перебором всех клиентов."""
    normalized = normalize_phone(phone)
    query = visible_query(me)
    if normalized is None or query is None:
        return None
    candidates = db.scalars(query.where(Counteragent.phones.contains(normalized, autoescape=True)).order_by(Counteragent.id).limit(20))
    return next((item for item in candidates if phones_match(item, normalized)), None)


@router.get("/{counteragent_id}", response_model=CounteragentDetail)
def get_counteragent(counteragent_id: int, db: DbSession, me: CurrentEmployee):
    require_order_read(me)
    item = db.get(Counteragent, counteragent_id)
    if item is None or item.is_deleted:
        raise NotFound("Контрагент")
    if item.is_vendor and not has_permission(me, "counteragentSellerAccess"):
        raise NotFound("Контрагент")
    orders_count = db.scalar(
        select(func.count()).select_from(Order).where(Order.counteragent_id == item.id, Order.is_deleted.is_(False))
    )
    return CounteragentDetail.model_validate({**CounteragentOut.model_validate(item).model_dump(), "orders_count": orders_count})


@router.get("/{counteragent_id}/history")
def counteragent_history(counteragent_id: int, db: DbSession, me: CurrentEmployee):
    require_order_read(me)
    item = db.get(Counteragent, counteragent_id)
    if item is None or item.is_deleted:
        raise NotFound("Контрагент")
    if item.is_vendor and not has_permission(me, "counteragentSellerAccess"):
        raise NotFound("Контрагент")

    scope = scope_of(me, "orders")
    orders_query = (
        select(Order, OrderStatus)
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(Order.counteragent_id == item.id, Order.is_deleted.is_(False))
    )
    allowed = location_ids(me)
    if allowed:
        orders_query = orders_query.where(Order.location_id.in_(allowed))
    if scope == "own":
        orders_query = orders_query.where(
            or_(Order.master_id == me.id, Order.manager_id == me.id, Order.created_by_id == me.id)
        )
    orders = db.execute(orders_query.order_by(Order.created_at.desc(), Order.id.desc()).limit(100)).all()

    sales = db.scalars(
        select(Sale)
        .where(Sale.counteragent_id == item.id, Sale.is_deleted.is_(False))
        .order_by(Sale.date.desc(), Sale.id.desc())
        .limit(100)
    ).all()

    transactions = db.execute(
        select(Transaction, CashItem)
        .join(CashItem, CashItem.id == Transaction.cash_item_id)
        .where(Transaction.counteragent_id == item.id, Transaction.is_deleted.is_(False))
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(100)
    ).all()

    return {
        "orders": [
            {
                "id": order.id,
                "number": order.number,
                "created_at": order.created_at,
                "status_name": status.name,
                "status_color": status.color,
                "device": " ".join(part for part in [order.device_type, order.brand, order.model] if part) or None,
                "total_price": order.total_price,
                "paid": order.paid,
            }
            for order, status in orders
        ],
        "sales": [
            {"id": sale.id, "number": sale.number, "date": sale.date, "total_price": sale.total_price}
            for sale in sales
        ],
        "transactions": [
            {
                "id": tx.id,
                "date": tx.date,
                "amount": tx.amount,
                "is_income": tx.is_income,
                "cash_item_name": cash_item.name,
                "note": tx.note,
            }
            for tx, cash_item in transactions
        ],
    }


@router.post("", response_model=CounteragentOut, dependencies=[Depends(require("counteragentAccess"))])
def create_counteragent(data: CounteragentIn, db: DbSession):
    validate_references(db, data)
    values = data.model_dump()
    values["name"] = values["name"].strip()
    values["phones"] = normalize_phones(values["phones"])
    item = Counteragent(**values)
    db.add(item)
    db.commit()
    return item


@router.put("/{counteragent_id}", response_model=CounteragentOut, dependencies=[Depends(require("counteragentAccess"))])
def update_counteragent(counteragent_id: int, data: CounteragentIn, db: DbSession):
    item = db.get(Counteragent, counteragent_id)
    if item is None or item.is_deleted:
        raise NotFound("Контрагент")
    validate_references(db, data)
    values = data.model_dump()
    values["name"] = values["name"].strip()
    values["phones"] = normalize_phones(values["phones"])
    for field, value in values.items():
        setattr(item, field, value)
    db.commit()
    return item


@router.delete("/{counteragent_id}", status_code=204, dependencies=[Depends(require("counteragentAccess"))])
def delete_counteragent(counteragent_id: int, db: DbSession):
    item = db.get(Counteragent, counteragent_id)
    if item is None or item.is_deleted:
        raise NotFound("Контрагент")
    item.is_deleted = True
    db.commit()
    return Response(status_code=204)