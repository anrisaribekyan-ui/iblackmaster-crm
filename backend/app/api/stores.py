from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.api.deps import CurrentEmployee, DbSession, check_location, location_ids, require
from app.errors import BusinessError, NotFound
from app.models import Location, StockBalance, Store

router = APIRouter(prefix="/stores", tags=["Настройки"])


class StoreIn(BaseModel):
    location_id: int
    name: str = Field(min_length=1, max_length=200)
    is_default: bool = False


class StoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    location_id: int
    name: str
    is_default: bool


def active_location(db: DbSession, location_id: int) -> Location:
    location = db.get(Location, location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    return location


def clear_default(db: DbSession, location_id: int, exclude_id: int | None = None) -> None:
    stores = db.scalars(select(Store).where(Store.location_id == location_id)).all()
    for store in stores:
        if store.id != exclude_id:
            store.is_default = False


@router.get("", response_model=list[StoreOut])
def list_stores(db: DbSession, me: CurrentEmployee, location_id: int | None = None):
    query = (
        select(Store)
        .join(Location)
        .where(Store.is_active.is_(True), Location.is_active.is_(True))
        .order_by(Store.id)
    )
    allowed = location_ids(me)
    if allowed:
        query = query.where(Store.location_id.in_(allowed))
    if location_id is not None:
        check_location(me, location_id)
        query = query.where(Store.location_id == location_id)
    return db.scalars(query).all()


@router.post("", response_model=StoreOut, dependencies=[Depends(require("storeSettingAccess"))])
def create_store(data: StoreIn, db: DbSession, me: CurrentEmployee):
    active_location(db, data.location_id)
    check_location(me, data.location_id)
    if data.is_default:
        clear_default(db, data.location_id)
    store = Store(**data.model_dump())
    db.add(store)
    db.commit()
    return store


@router.put("/{store_id}", response_model=StoreOut, dependencies=[Depends(require("storeSettingAccess"))])
def update_store(store_id: int, data: StoreIn, db: DbSession, me: CurrentEmployee):
    store = db.get(Store, store_id)
    if store is None or not store.is_active:
        raise NotFound("Склад")
    check_location(me, store.location_id)
    active_location(db, data.location_id)
    check_location(me, data.location_id)
    if data.is_default:
        clear_default(db, data.location_id, exclude_id=store_id)
    for field, value in data.model_dump().items():
        setattr(store, field, value)
    db.commit()
    return store


@router.delete("/{store_id}", status_code=204, dependencies=[Depends(require("storeSettingAccess"))])
def delete_store(store_id: int, db: DbSession, me: CurrentEmployee):
    store = db.get(Store, store_id)
    if store is None or not store.is_active:
        raise NotFound("Склад")
    check_location(me, store.location_id)
    quantity = db.scalar(
        select(func.coalesce(func.sum(StockBalance.quantity), 0)).where(StockBalance.store_id == store_id)
    )
    if quantity > 0:
        raise BusinessError("На складе есть товар")
    store.is_active = False
    db.commit()
    return Response(status_code=204)