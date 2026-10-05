from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require, scope_of
from app.errors import BusinessError, Forbidden, NotFound
from app.models import (
    CashRegister,
    Counteragent,
    Employee,
    FormField,
    Order,
    OrderHistory,
    OrderPosition,
    OrderStatus,
    OrderType,
    StatusGroup,
    Transaction,
)
from app.services import orders as order_service
from app.utils.phone import normalize_phone

router = APIRouter(prefix="/orders", tags=["Заказы"])


class CounteragentRefIn(BaseModel):
    id: int | None = None
    type_id: int | None = None
    name: str | None = None
    phones: str | None = None
    email: str | None = None
    address: str | None = None
    how_know_id: int | None = None
    is_buyer: bool = True


class OrderCreate(BaseModel):
    location_id: int
    order_type_id: int
    counteragent: CounteragentRefIn
    device_type: str | None = None
    brand: str | None = None
    model: str | None = None
    serial: str | None = None
    problems: list[str] = Field(default_factory=list)
    complete_set: list[str] = Field(default_factory=list)
    appearance: list[str] = Field(default_factory=list)
    color: str | None = None
    device_password: str | None = None
    note: str | None = None
    approximate_price: str | None = None
    has_prepayment: bool = False
    deadline: str | None = None
    is_urgent: bool = False
    how_know_id: int | None = None
    verdict: str | None = None
    custom_fields: dict = Field(default_factory=dict)
    master_id: int | None = None
    manager_id: int | None = None


class OrderCreateOut(BaseModel):
    id: int
    number: str


class OrderDetailCounteragent(BaseModel):
    id: int
    name: str
    phones: str | None
    balance: Decimal


class OrderDetailStatus(BaseModel):
    id: int
    group: str
    name: str
    color: str


class OrderDetailType(BaseModel):
    id: int
    name: str


class OrderDetailEmployee(BaseModel):
    id: int
    short_name: str


class OrderDetailOut(BaseModel):
    order: dict
    status: OrderDetailStatus
    order_type: OrderDetailType
    counteragent: OrderDetailCounteragent
    master: OrderDetailEmployee | None
    manager: OrderDetailEmployee | None
    positions: list[dict]
    history: list[dict]
    transactions: list[dict]
    debt: Decimal


class OrderListOut(BaseModel):
    items: list[dict]
    total: int
    counts: dict[str, int]


def normalized_phones(raw: str | None) -> str | None:
    if not raw:
        return None
    values = []
    for phone in raw.split(","):
        digits = normalize_phone(phone)
        if digits and digits not in values:
            values.append(digits)
    return ",".join(values) or None


def get_order_type(db: DbSession, order_type_id: int) -> OrderType:
    order_type = db.get(OrderType, order_type_id)
    if order_type is None or not order_type.is_active:
        raise NotFound("Тип заказа")
    return order_type


def get_employee(db: DbSession, employee_id: int | None, label: str) -> Employee | None:
    if employee_id is None:
        return None
    employee = db.get(Employee, employee_id)
    if employee is None or not employee.is_active:
        raise NotFound(label)
    return employee


def resolve_counteragent(db: DbSession, ref: CounteragentRefIn) -> Counteragent:
    if ref.id is not None:
        counteragent = db.get(Counteragent, ref.id)
        if counteragent is None or counteragent.is_deleted:
            raise NotFound("Контрагент")
        return counteragent
    if not (ref.name or "").strip():
        raise BusinessError("Заполните поле «Имя»")
    counteragent = Counteragent(
        type_id=ref.type_id,
        name=ref.name.strip(),
        phones=normalized_phones(ref.phones),
        email=ref.email,
        address=ref.address,
        how_know_id=ref.how_know_id,
        is_buyer=ref.is_buyer,
    )
    db.add(counteragent)
    db.flush()
    return counteragent


def required_value(field: FormField, data: OrderCreate, counteragent: Counteragent):
    if field.key in data.custom_fields:
        return data.custom_fields[field.key]
    aliases = {
        "name": counteragent.name,
        "phones": counteragent.phones,
        "howKnow": data.how_know_id or counteragent.how_know_id,
        "deviceType": data.device_type,
        "brand": data.brand,
        "model": data.model,
        "sn": data.serial,
        "problem": data.problems,
        "completeSet": data.complete_set,
        "appearance": data.appearance,
        "color": data.color,
        "password": data.device_password,
        "orderNode": data.note,
        "approximatePrice": data.approximate_price,
        "prepayment": data.has_prepayment,
        "deadline": data.deadline,
        "isUrgent": data.is_urgent,
        "master": data.master_id,
        "manager": data.manager_id,
    }
    return aliases.get(field.key)


def validate_required_fields(db: DbSession, order_type_id: int, data: OrderCreate, counteragent: Counteragent) -> None:
    fields = db.scalars(
        select(FormField).where(
            FormField.order_type_id == order_type_id,
            FormField.is_visible.is_(True),
            FormField.is_required.is_(True),
        )
    ).all()
    for field in fields:
        value = required_value(field, data, counteragent)
        if value is None or value == "" or value == []:
            raise BusinessError(f"Заполните поле «{field.label}»")


def assert_order_access(order: Order, employee: CurrentEmployee) -> None:
    check_location(employee, order.location_id)
    scope = scope_of(employee, "orders")
    if scope == "none":
        raise Forbidden("Нет доступа к заказам")
    if scope == "own" and employee.id not in {order.master_id, order.manager_id, order.created_by_id}:
        raise Forbidden("Нет доступа к этому заказу")


def model_values(item) -> dict:
    return {column.name: getattr(item, column.name) for column in item.__table__.columns}


@router.get("", response_model=OrderListOut)
def list_orders(
    db: DbSession,
    me: CurrentEmployee,
    location_id: int | None = None,
    tab: Literal["new", "inWork", "wait", "finish", "closed", "all"] = "all",
    status_id: int | None = None,
    order_type_id: int | None = None,
    master_id: int | None = None,
    manager_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    urgent: bool | None = None,
    overdue: bool | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    deleted: bool = False,
):
    scope = scope_of(me, "orders")
    if scope == "none":
        raise Forbidden("Нет доступа к заказам")
    if deleted and not has_permission(me, "viewDeleteOrderAccess"):
        raise Forbidden("Нет права видеть удалённые заказы")

    query = select(Order, OrderStatus, Counteragent).join(OrderStatus).join(Counteragent)
    if deleted:
        query = query.where(Order.is_deleted.is_(True))
    else:
        query = query.where(Order.is_deleted.is_(False))

    allowed = location_ids(me)
    if allowed:
        query = query.where(Order.location_id.in_(allowed))
    if location_id is not None:
        check_location(me, location_id)
        query = query.where(Order.location_id == location_id)
    if scope == "own":
        query = query.where(
            or_(Order.master_id == me.id, Order.manager_id == me.id, Order.created_by_id == me.id)
        )
    if status_id is not None:
        query = query.where(Order.status_id == status_id)
    if order_type_id is not None:
        query = query.where(Order.order_type_id == order_type_id)
    if master_id is not None:
        query = query.where(Order.master_id == master_id)
    if manager_id is not None:
        query = query.where(Order.manager_id == manager_id)
    if date_from is not None:
        query = query.where(Order.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to is not None:
        query = query.where(Order.created_at < datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    if urgent is not None:
        query = query.where(Order.is_urgent.is_(urgent))
    if overdue is True:
        query = query.where(
            Order.deadline.is_not(None),
            Order.deadline < datetime.now(timezone.utc),
            OrderStatus.group != StatusGroup.CLOSED,
        )
    elif overdue is False:
        query = query.where(
            or_(Order.deadline.is_(None), Order.deadline >= datetime.now(timezone.utc), OrderStatus.group == StatusGroup.CLOSED)
        )

    rows = db.execute(query.order_by(Order.created_at.desc(), Order.id.desc())).all()
    if q:
        term = q.strip().casefold()
        normalized = normalize_phone(q)
        raw_digits = "".join(char for char in q if char.isdecimal())

        def matches(row) -> bool:
            order, _, counteragent = row
            if term in order.number.casefold() or term in (order.serial or "").casefold() or term in (order.model or "").casefold():
                return True
            if term in counteragent.name.casefold():
                return True
            phones = [phone.strip() for phone in (counteragent.phones or "").split(",")]
            if normalized:
                return any(phone == normalized for phone in phones)
            return len(raw_digits) >= 3 and any(raw_digits in phone for phone in phones)

        rows = [row for row in rows if matches(row)]

    counts = {group.value: 0 for group in StatusGroup}
    for _, status, _ in rows:
        counts[StatusGroup(status.group).value] += 1

    if tab != "all":
        rows = [row for row in rows if StatusGroup(row[1].group).value == tab]
    total = len(rows)
    rows = rows[(page - 1) * 50 : page * 50]

    items = []
    for order, status, counteragent in rows:
        manager = db.get(Employee, order.manager_id) if order.manager_id else None
        items.append(
            {
                "id": order.id,
                "number": order.number,
                "status": {"id": status.id, "group": status.group, "name": status.name, "color": status.color},
                "deadline": order.deadline,
                "manager": manager.short_name if manager else None,
                "created_at": order.created_at,
                "order_type_id": order.order_type_id,
                "device_type": order.device_type,
                "brand": order.brand,
                "model": order.model,
                "serial": order.serial,
                "problems": order.problems,
                "counteragent": {"id": counteragent.id, "name": counteragent.name, "phones": counteragent.phones},
                "total_price": order.total_price,
                "paid": order.paid,
                "is_urgent": order.is_urgent,
            }
        )
    return OrderListOut(items=items, total=total, counts=counts)


@router.post("", response_model=OrderCreateOut, dependencies=[Depends(require("createOrderAccess"))])
def create_order(data: OrderCreate, db: DbSession, me: CurrentEmployee):
    check_location(me, data.location_id)
    order_type = get_order_type(db, data.order_type_id)
    counteragent = resolve_counteragent(db, data.counteragent)
    validate_required_fields(db, order_type.id, data, counteragent)
    master = get_employee(db, data.master_id, "Мастер")
    manager = get_employee(db, data.manager_id, "Менеджер")

    form_fields = db.scalars(select(FormField).where(FormField.order_type_id == order_type.id)).all()
    master_id = master.id if master else None
    manager_id = manager.id if manager else None
    for field in form_fields:
        if isinstance(field.default_value, dict) and field.default_value.get("current_user"):
            if field.key == "master" and master_id is None:
                master_id = me.id
            if field.key == "manager" and manager_id is None:
                manager_id = me.id

    first_status = db.scalars(
        select(OrderStatus)
        .where(OrderStatus.group == StatusGroup.NEW, OrderStatus.is_active.is_(True))
        .order_by(OrderStatus.sort, OrderStatus.id)
    ).first()
    if first_status is None:
        raise BusinessError("Не настроен начальный статус заказа")

    order = Order(
        **data.model_dump(exclude={"counteragent", "master_id", "manager_id"}),
        number=order_service.next_order_number(db),
        status_id=first_status.id,
        counteragent_id=counteragent.id,
        master_id=master_id,
        manager_id=manager_id,
        created_by_id=me.id,
    )
    db.add(order)
    db.flush()
    order_service.add_history(db, order, "created", me, status_id=first_status.id)
    db.commit()
    return OrderCreateOut(id=order.id, number=order.number)


@router.get("/{order_id}", response_model=OrderDetailOut)
def get_order(order_id: int, db: DbSession, me: CurrentEmployee):
    order = db.get(Order, order_id)
    if order is None or order.is_deleted:
        raise NotFound("Заказ")
    assert_order_access(order, me)

    status = db.get(OrderStatus, order.status_id)
    order_type = db.get(OrderType, order.order_type_id)
    counteragent = db.get(Counteragent, order.counteragent_id)
    master = db.get(Employee, order.master_id) if order.master_id else None
    manager = db.get(Employee, order.manager_id) if order.manager_id else None
    can_view_purchase = has_permission(me, "purchasePriceAccess")
    can_view_margin = has_permission(me, "marginPriceAccess")

    positions = db.scalars(select(OrderPosition).where(OrderPosition.order_id == order.id).order_by(OrderPosition.id)).all()
    position_values = []
    for position in positions:
        values = model_values(position)
        values["total"] = position.total
        values["purchase_price"] = position.purchase_price if can_view_purchase else None
        values["margin"] = position.margin if can_view_margin else None
        position_values.append(values)

    history = db.scalars(
        select(OrderHistory).where(OrderHistory.order_id == order.id).order_by(OrderHistory.created_at.desc(), OrderHistory.id.desc())
    ).all()
    employee_ids = {entry.employee_id for entry in history if entry.employee_id is not None}
    employees = db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all() if employee_ids else []
    employee_names = {employee.id: employee.short_name for employee in employees}
    history_values = [
        {**model_values(entry), "employee_name": employee_names.get(entry.employee_id)}
        for entry in history
    ]
    transactions = db.scalars(
        select(Transaction)
        .where(Transaction.order_id == order.id, Transaction.is_deleted.is_(False))
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    ).all()

    return OrderDetailOut(
        order=model_values(order),
        status={"id": status.id, "group": status.group, "name": status.name, "color": status.color},
        order_type={"id": order_type.id, "name": order_type.name},
        counteragent={"id": counteragent.id, "name": counteragent.name, "phones": counteragent.phones, "balance": counteragent.balance},
        master={"id": master.id, "short_name": master.short_name} if master else None,
        manager={"id": manager.id, "short_name": manager.short_name} if manager else None,
        positions=position_values,
        history=history_values,
        transactions=[model_values(transaction) for transaction in transactions],
        debt=order.debt,
    )