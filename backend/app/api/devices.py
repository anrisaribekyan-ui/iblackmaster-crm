from decimal import Decimal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.db import Rubles
from app.errors import NotFound
from app.models import Brand, DeviceModel, DeviceType

router = APIRouter(tags=["Устройства"])


class DeviceTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    salary_percent: Decimal | None = None
    salary_fixed: Rubles | None = None


class DeviceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    salary_percent: Decimal | None
    salary_fixed: Decimal | None


class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    device_type_id: int | None = None


class BrandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_type_id: int | None
    name: str


class DeviceModelIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    brand_id: int


class DeviceModelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    brand_id: int
    name: str


class DeviceSuggestion(BaseModel):
    id: int
    brand_id: int
    brand: str
    model: str
    name: str


@router.get("/device-types", response_model=list[DeviceTypeOut])
def list_device_types(db: DbSession, _: CurrentEmployee):
    return db.scalars(select(DeviceType).order_by(DeviceType.name, DeviceType.id)).all()


@router.post("/device-types", response_model=DeviceTypeOut, dependencies=[Depends(require("brandModelDeviceAccess"))])
def create_device_type(data: DeviceTypeIn, db: DbSession):
    item = DeviceType(**data.model_dump())
    item.name = item.name.strip()
    db.add(item)
    db.commit()
    return item


@router.put(
    "/device-types/{item_id}",
    response_model=DeviceTypeOut,
    dependencies=[Depends(require("brandModelDeviceAccess"))],
)
def update_device_type(item_id: int, data: DeviceTypeIn, db: DbSession):
    item = db.get(DeviceType, item_id)
    if item is None:
        raise NotFound("Тип устройства")
    for field, value in data.model_dump().items():
        setattr(item, field, value)
    item.name = item.name.strip()
    db.commit()
    return item


@router.delete(
    "/device-types/{item_id}",
    status_code=204,
    dependencies=[Depends(require("brandModelDeviceAccess"))],
)
def delete_device_type(item_id: int, db: DbSession):
    item = db.get(DeviceType, item_id)
    if item is None:
        raise NotFound("Тип устройства")
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.get("/brands", response_model=list[BrandOut])
def list_brands(db: DbSession, _: CurrentEmployee, device_type_id: int | None = None):
    query = select(Brand).order_by(Brand.name, Brand.id)
    if device_type_id is not None:
        query = query.where(Brand.device_type_id == device_type_id)
    return db.scalars(query).all()


@router.post("/brands", response_model=BrandOut, dependencies=[Depends(require("brandModelDeviceAccess"))])
def create_brand(data: BrandIn, db: DbSession):
    if data.device_type_id is not None and db.get(DeviceType, data.device_type_id) is None:
        raise NotFound("Тип устройства")
    item = Brand(name=data.name.strip(), device_type_id=data.device_type_id)
    db.add(item)
    db.commit()
    return item


@router.put("/brands/{item_id}", response_model=BrandOut, dependencies=[Depends(require("brandModelDeviceAccess"))])
def update_brand(item_id: int, data: BrandIn, db: DbSession):
    item = db.get(Brand, item_id)
    if item is None:
        raise NotFound("Марка")
    if data.device_type_id is not None and db.get(DeviceType, data.device_type_id) is None:
        raise NotFound("Тип устройства")
    item.name = data.name.strip()
    item.device_type_id = data.device_type_id
    db.commit()
    return item


@router.delete("/brands/{item_id}", status_code=204, dependencies=[Depends(require("brandModelDeviceAccess"))])
def delete_brand(item_id: int, db: DbSession):
    item = db.get(Brand, item_id)
    if item is None:
        raise NotFound("Марка")
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.get("/device-models", response_model=list[DeviceModelOut])
def list_device_models(db: DbSession, _: CurrentEmployee, brand_id: int | None = None):
    query = select(DeviceModel).order_by(DeviceModel.name, DeviceModel.id)
    if brand_id is not None:
        query = query.where(DeviceModel.brand_id == brand_id)
    return db.scalars(query).all()


@router.post(
    "/device-models",
    response_model=DeviceModelOut,
    dependencies=[Depends(require("brandModelDeviceAccess"))],
)
def create_device_model(data: DeviceModelIn, db: DbSession):
    if db.get(Brand, data.brand_id) is None:
        raise NotFound("Марка")
    item = DeviceModel(name=data.name.strip(), brand_id=data.brand_id)
    db.add(item)
    db.commit()
    return item


@router.put(
    "/device-models/{item_id}",
    response_model=DeviceModelOut,
    dependencies=[Depends(require("brandModelDeviceAccess"))],
)
def update_device_model(item_id: int, data: DeviceModelIn, db: DbSession):
    item = db.get(DeviceModel, item_id)
    if item is None:
        raise NotFound("Модель устройства")
    if db.get(Brand, data.brand_id) is None:
        raise NotFound("Марка")
    item.name = data.name.strip()
    item.brand_id = data.brand_id
    db.commit()
    return item


@router.delete(
    "/device-models/{item_id}",
    status_code=204,
    dependencies=[Depends(require("brandModelDeviceAccess"))],
)
def delete_device_model(item_id: int, db: DbSession):
    item = db.get(DeviceModel, item_id)
    if item is None:
        raise NotFound("Модель устройства")
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.get("/devices/suggest", response_model=list[DeviceSuggestion])
def suggest_devices(db: DbSession, _: CurrentEmployee, q: str = ""):
    rows = db.execute(
        select(Brand, DeviceModel)
        .join(DeviceModel, DeviceModel.brand_id == Brand.id)
        .order_by(Brand.name, DeviceModel.name, DeviceModel.id)
    ).all()
    term = q.strip().casefold()
    suggestions = []
    for brand, model in rows:
        label = f"{brand.name} {model.name}"
        if term and term not in label.casefold():
            continue
        suggestions.append(
            DeviceSuggestion(
                id=model.id,
                brand_id=brand.id,
                brand=brand.name,
                model=model.name,
                name=label,
            )
        )
        if len(suggestions) == 20:
            break
    return suggestions