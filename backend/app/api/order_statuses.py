from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import BusinessError, NotFound
from app.models import Order, OrderStatus, StatusGroup, STATUS_GROUP_TITLES

router = APIRouter(prefix="/order-statuses", tags=["Настройки"])

StatusGroupValue = Literal["new", "inWork", "wait", "finish", "closed"]
CommentMode = Literal["none", "optional", "required"]


class OrderStatusIn(BaseModel):
    group: StatusGroupValue
    name: str = Field(min_length=1, max_length=100)
    client_name: str | None = Field(default=None, max_length=200)
    color: str = Field(min_length=1, max_length=9)
    sort: int = 0
    pay_required: bool = False
    comment_mode: CommentMode = "none"
    role_access: dict[str, dict[Literal["view", "set", "change"], bool]] = Field(default_factory=dict)


class OrderStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group: str
    name: str
    client_name: str | None
    color: str
    sort: int
    pay_required: bool
    comment_mode: str
    role_access: dict
    is_active: bool


def get_order_status(db: DbSession, status_id: int) -> OrderStatus:
    status = db.get(OrderStatus, status_id)
    if status is None or not status.is_active:
        raise NotFound("Статус заказа")
    return status


@router.get("")
def list_order_statuses(db: DbSession, _: CurrentEmployee):
    statuses = db.scalars(
        select(OrderStatus)
        .where(OrderStatus.is_active.is_(True))
        .order_by(OrderStatus.sort, OrderStatus.id)
    ).all()
    by_group = {group.value: [] for group in StatusGroup}
    for status in statuses:
        by_group[status.group].append(OrderStatusOut.model_validate(status).model_dump())
    return [
        {
            "group": group.value,
            "title": STATUS_GROUP_TITLES[group],
            "statuses": by_group[group.value],
        }
        for group in StatusGroup
    ]


@router.post("", response_model=OrderStatusOut, dependencies=[Depends(require("settingAccess"))])
def create_order_status(data: OrderStatusIn, db: DbSession):
    status = OrderStatus(**data.model_dump())
    db.add(status)
    db.commit()
    return status


@router.put("/{status_id}", response_model=OrderStatusOut, dependencies=[Depends(require("settingAccess"))])
def update_order_status(status_id: int, data: OrderStatusIn, db: DbSession):
    status = get_order_status(db, status_id)
    for field, value in data.model_dump().items():
        setattr(status, field, value)
    db.commit()
    return status


@router.delete("/{status_id}", status_code=204, dependencies=[Depends(require("settingAccess"))])
def delete_order_status(status_id: int, db: DbSession):
    status = get_order_status(db, status_id)
    if status.group != StatusGroup.CLOSED and db.scalar(
        select(Order.id).where(Order.status_id == status_id).limit(1)
    ) is not None:
        raise BusinessError("Нельзя удалить статус с незакрытыми заказами")
    active_statuses = db.scalars(
        select(OrderStatus.id).where(
            OrderStatus.group == status.group,
            OrderStatus.is_active.is_(True),
        )
    ).all()
    if len(active_statuses) <= 1:
        raise BusinessError("Нельзя удалить последний статус в группе")
    status.is_active = False
    db.commit()
    return Response(status_code=204)
