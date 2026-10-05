from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.api.deps import CurrentEmployee, DbSession, has_permission, require, scope_of
from app.errors import BusinessError, Forbidden, NotFound
from app.models import Counteragent, CounteragentType, Employee, HowKnow, Order
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


def visible_counteragents(db: DbSession, me: CurrentEmployee, is_vendor: bool | None = None):
    require_order_read(me)
    query = select(Counteragent).where(Counteragent.is_deleted.is_(False)).order_by(Counteragent.name, Counteragent.id)
    can_view_vendors = has_permission(me, "counteragentSellerAccess")
    if is_vendor is not None:
        if is_vendor and not can_view_vendors:
            return []
        query = query.where(Counteragent.is_vendor.is_(is_vendor))
    elif not can_view_vendors:
        query = query.where(Counteragent.is_vendor.is_(False))
    return db.scalars(query).all()


@router.get("", response_model=CounteragentPage)
def list_counteragents(
    db: DbSession,
    me: CurrentEmployee,
    q: str | None = None,
    is_vendor: bool | None = None,
    page: int = Query(default=1, ge=1),
):
    items = visible_counteragents(db, me, is_vendor)
    if q:
        term = q.strip().casefold()
        normalized = normalize_phone(q)
        raw_digits = "".join(char for char in q if char.isdecimal())
        if normalized:
            items = [item for item in items if phones_match(item, normalized)]
        elif len(raw_digits) >= 3:
            items = [
                item
                for item in items
                if any(raw_digits in phone.strip() for phone in (item.phones or "").split(","))
            ]
        else:
            items = [item for item in items if term in item.name.casefold()]
    total = len(items)
    return CounteragentPage(items=items[(page - 1) * 50 : page * 50], total=total, page=page)


@router.get("/by-phone", response_model=CounteragentOut | None)
def counteragent_by_phone(phone: str, db: DbSession, me: CurrentEmployee):
    require_order_read(me)
    normalized = normalize_phone(phone)
    if normalized is None:
        return None
    items = visible_counteragents(db, me)
    return next((item for item in items if phones_match(item, normalized)), None)


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