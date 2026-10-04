from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import NotFound
from app.models import CounteragentType

router = APIRouter(prefix="/counteragent-types", tags=["Справочники"])


class CounteragentTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort: int = 0


class CounteragentTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort: int


@router.get("", response_model=list[CounteragentTypeOut])
def list_counteragent_types(db: DbSession, _: CurrentEmployee, q: str | None = None):
    items = db.scalars(select(CounteragentType).order_by(CounteragentType.sort, CounteragentType.id)).all()
    if q:
        term = q.strip().casefold()
        items = [item for item in items if term in item.name.casefold()]
    return items


@router.post("", response_model=CounteragentTypeOut, dependencies=[Depends(require("counteragentAccess"))])
def create_counteragent_type(data: CounteragentTypeIn, db: DbSession):
    item = CounteragentType(name=data.name.strip(), sort=data.sort)
    db.add(item)
    db.commit()
    return item


@router.put("/{item_id}", response_model=CounteragentTypeOut, dependencies=[Depends(require("counteragentAccess"))])
def update_counteragent_type(item_id: int, data: CounteragentTypeIn, db: DbSession):
    item = db.get(CounteragentType, item_id)
    if item is None:
        raise NotFound("Тип контрагента")
    item.name = data.name.strip()
    item.sort = data.sort
    db.commit()
    return item


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require("counteragentAccess"))])
def delete_counteragent_type(item_id: int, db: DbSession):
    item = db.get(CounteragentType, item_id)
    if item is None:
        raise NotFound("Тип контрагента")
    db.delete(item)
    db.commit()
    return Response(status_code=204)