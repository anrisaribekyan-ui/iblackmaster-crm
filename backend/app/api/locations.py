from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentEmployee, DbSession, location_ids, require
from app.errors import BusinessError, NotFound
from app.models import Location, Store

router = APIRouter(prefix="/locations", tags=["Настройки"])


class LocationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    phones: str | None = Field(default=None, max_length=300)
    work_hours: str | None = Field(default=None, max_length=100)
    color: str = Field(default="#171717", pattern=r"^#[0-9A-Fa-f]{6}$")
    sort: int = 0


class StoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_default: bool


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str | None
    phones: str | None
    work_hours: str | None = None
    color: str
    sort: int
    stores: list[StoreOut]


def location_out(location: Location) -> LocationOut:
    return LocationOut(
        id=location.id,
        name=location.name,
        address=location.address,
        phones=location.phones,
        work_hours=location.work_hours,
        color=location.color,
        sort=location.sort,
        stores=[StoreOut.model_validate(store) for store in location.stores if store.is_active],
    )


@router.get("", response_model=list[LocationOut])
def list_locations(db: DbSession, me: CurrentEmployee):
    query = (
        select(Location)
        .options(selectinload(Location.stores))
        .where(Location.is_active.is_(True))
        .order_by(Location.sort, Location.id)
    )
    allowed = location_ids(me)
    if allowed:
        query = query.where(Location.id.in_(allowed))
    return [location_out(location) for location in db.scalars(query).all()]


@router.post("", response_model=LocationOut, dependencies=[Depends(require("settingAccess"))])
def create_location(data: LocationIn, db: DbSession):
    values = data.model_dump()
    values["name"] = values["name"].strip()
    location = Location(**values)
    db.add(location)
    db.commit()
    return location_out(location)


@router.put("/{location_id}", response_model=LocationOut, dependencies=[Depends(require("settingAccess"))])
def update_location(location_id: int, data: LocationIn, db: DbSession):
    location = db.get(Location, location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    values = data.model_dump()
    values["name"] = values["name"].strip()
    for field, value in values.items():
        setattr(location, field, value)
    db.commit()
    return location_out(location)


@router.delete("/{location_id}", status_code=204, dependencies=[Depends(require("settingAccess"))])
def delete_location(location_id: int, db: DbSession):
    location = db.get(Location, location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    active_count = db.scalar(select(func.count()).select_from(Location).where(Location.is_active.is_(True)))
    if active_count <= 1:
        raise BusinessError("Нельзя удалить последнюю активную локацию")
    location.is_active = False
    db.commit()
    return Response(status_code=204)