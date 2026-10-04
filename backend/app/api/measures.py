from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import NotFound
from app.models import Measure

router = APIRouter(prefix="/measures", tags=["Справочники"])


class MeasureIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    is_float: bool = False


class MeasureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_float: bool


@router.get("", response_model=list[MeasureOut])
def list_measures(db: DbSession, _: CurrentEmployee, q: str | None = None):
    items = db.scalars(select(Measure).order_by(Measure.name)).all()
    if q:
        term = q.strip().casefold()
        items = [item for item in items if term in item.name.casefold()]
    return items


@router.post("", response_model=MeasureOut, dependencies=[Depends(require("measureAccess"))])
def create_measure(data: MeasureIn, db: DbSession):
    item = Measure(name=data.name.strip(), is_float=data.is_float)
    db.add(item)
    db.commit()
    return item


@router.put("/{item_id}", response_model=MeasureOut, dependencies=[Depends(require("measureAccess"))])
def update_measure(item_id: int, data: MeasureIn, db: DbSession):
    item = db.get(Measure, item_id)
    if item is None:
        raise NotFound("Единица измерения")
    item.name = data.name.strip()
    item.is_float = data.is_float
    db.commit()
    return item


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require("measureAccess"))])
def delete_measure(item_id: int, db: DbSession):
    item = db.get(Measure, item_id)
    if item is None:
        raise NotFound("Единица измерения")
    db.delete(item)
    db.commit()
    return Response(status_code=204)