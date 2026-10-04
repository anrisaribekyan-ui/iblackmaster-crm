from uuid import uuid4

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import BusinessError, NotFound
from app.models import FieldDataType, FormField, OrderType

router = APIRouter(prefix="/order-types", tags=["Настройки"])


class OrderTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort: int = 0


class OrderTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort: int
    is_active: bool


class FormFieldIn(BaseModel):
    id: int | None = None
    key: str = Field(min_length=1, max_length=50)
    label: str = Field(min_length=1, max_length=100)
    group: str = Field(min_length=1, max_length=20)
    data_type: FieldDataType
    place: str = Field(min_length=1, max_length=10)
    is_required: bool = False
    is_only_dictionary: bool = False
    default_value: object | None = None
    items: list[str] | None = None
    is_visible: bool = True


class FormFieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_type_id: int | None
    key: str
    label: str
    group: str
    data_type: FieldDataType
    place: str
    is_required: bool
    is_only_dictionary: bool
    default_value: object | None
    items: list[str] | None
    is_visible: bool


def get_active_order_type(db: DbSession, order_type_id: int) -> OrderType:
    order_type = db.get(OrderType, order_type_id)
    if order_type is None or not order_type.is_active:
        raise NotFound("Тип заказа")
    return order_type


@router.get("", response_model=list[OrderTypeOut])
def list_order_types(db: DbSession, _: CurrentEmployee):
    query = select(OrderType).where(OrderType.is_active.is_(True)).order_by(OrderType.sort, OrderType.id)
    return db.scalars(query).all()


@router.post("", response_model=OrderTypeOut, dependencies=[Depends(require("settingAccess"))])
def create_order_type(data: OrderTypeIn, db: DbSession):
    first_type = db.scalars(select(OrderType).where(OrderType.is_active.is_(True)).order_by(OrderType.sort, OrderType.id)).first()
    order_type = OrderType(name=data.name.strip(), sort=data.sort)
    db.add(order_type)
    db.flush()

    if first_type is not None:
        fields = db.scalars(
            select(FormField).where(FormField.order_type_id == first_type.id).order_by(FormField.place, FormField.id)
        ).all()
        for field in fields:
            db.add(
                FormField(
                    order_type_id=order_type.id,
                    counteragent_type_id=None,
                    key=field.key,
                    label=field.label,
                    group=field.group,
                    data_type=field.data_type,
                    place=field.place,
                    is_required=field.is_required,
                    is_only_dictionary=field.is_only_dictionary,
                    default_value=field.default_value,
                    items=field.items,
                    is_visible=field.is_visible,
                )
            )
    db.commit()
    return order_type


@router.put("/{order_type_id}", response_model=OrderTypeOut, dependencies=[Depends(require("settingAccess"))])
def update_order_type(order_type_id: int, data: OrderTypeIn, db: DbSession):
    order_type = get_active_order_type(db, order_type_id)
    order_type.name = data.name.strip()
    order_type.sort = data.sort
    db.commit()
    return order_type


@router.delete("/{order_type_id}", status_code=204, dependencies=[Depends(require("settingAccess"))])
def delete_order_type(order_type_id: int, db: DbSession):
    order_type = get_active_order_type(db, order_type_id)
    order_type.is_active = False
    db.commit()
    return Response(status_code=204)


@router.get("/{order_type_id}/fields", response_model=list[FormFieldOut])
def list_form_fields(order_type_id: int, db: DbSession, _: CurrentEmployee):
    get_active_order_type(db, order_type_id)
    query = (
        select(FormField)
        .where(FormField.order_type_id == order_type_id)
        .order_by(FormField.place, FormField.id)
    )
    return db.scalars(query).all()


@router.put(
    "/{order_type_id}/fields",
    response_model=list[FormFieldOut],
    dependencies=[Depends(require("settingAccess"))],
)
def update_form_fields(order_type_id: int, data: list[FormFieldIn], db: DbSession):
    get_active_order_type(db, order_type_id)
    existing = db.scalars(select(FormField).where(FormField.order_type_id == order_type_id)).all()
    existing_by_id = {field.id: field for field in existing}
    incoming_name = next((field for field in data if field.key == "name"), None)
    current_name = next((field for field in existing if field.key == "name"), None)
    if current_name is not None and (incoming_name is None or not incoming_name.is_required):
        raise BusinessError("Поле имени клиента должно оставаться обязательным")

    submitted_ids = {field.id for field in data if field.id is not None}
    if submitted_ids - existing_by_id.keys():
        raise BusinessError("Поле не принадлежит этому типу заказа")

    for field in existing:
        if field.id not in submitted_ids:
            field.is_visible = False

    for item in data:
        values = item.model_dump(exclude={"id"})
        if item.id is None:
            values["key"] = f"custom_{uuid4().hex[:8]}"
            values["group"] = "custom"
            db.add(FormField(order_type_id=order_type_id, counteragent_type_id=None, **values))
        else:
            field = existing_by_id[item.id]
            for name, value in values.items():
                setattr(field, name, value)

    db.commit()
    query = (
        select(FormField)
        .where(FormField.order_type_id == order_type_id)
        .order_by(FormField.place, FormField.id)
    )
    return db.scalars(query).all()