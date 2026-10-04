from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import NotFound
from app.models import CompleteSet

router = APIRouter(prefix="/complete-sets", tags=["Справочники"])


class CompleteSetIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class CompleteSetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


@router.get("", response_model=list[CompleteSetOut])
def list_complete_sets(db: DbSession, _: CurrentEmployee, q: str | None = None):
    items = db.scalars(select(CompleteSet).order_by(CompleteSet.name)).all()
    if q:
        term = q.strip().casefold()
        items = [item for item in items if term in item.name.casefold()]
    return items


@router.post("", response_model=CompleteSetOut, dependencies=[Depends(require("completeSetAccess"))])
def create_complete_set(data: CompleteSetIn, db: DbSession):
    item = CompleteSet(name=data.name.strip())
    db.add(item)
    db.commit()
    return item


@router.put("/{item_id}", response_model=CompleteSetOut, dependencies=[Depends(require("completeSetAccess"))])
def update_complete_set(item_id: int, data: CompleteSetIn, db: DbSession):
    item = db.get(CompleteSet, item_id)
    if item is None:
        raise NotFound("Комплектация")
    item.name = data.name.strip()
    db.commit()
    return item


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require("completeSetAccess"))])
def delete_complete_set(item_id: int, db: DbSession):
    item = db.get(CompleteSet, item_id)
    if item is None:
        raise NotFound("Комплектация")
    db.delete(item)
    db.commit()
    return Response(status_code=204)