from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import NotFound
from app.models import Problem

router = APIRouter(prefix="/problems", tags=["Справочники"])


class ProblemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProblemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


@router.get("", response_model=list[ProblemOut])
def list_problems(db: DbSession, _: CurrentEmployee, q: str | None = None):
    items = db.scalars(select(Problem).order_by(Problem.name)).all()
    if q:
        term = q.strip().casefold()
        items = [item for item in items if term in item.name.casefold()]
    return items


@router.post("", response_model=ProblemOut, dependencies=[Depends(require("problemAccess"))])
def create_problem(data: ProblemIn, db: DbSession):
    item = Problem(name=data.name.strip())
    db.add(item)
    db.commit()
    return item


@router.put("/{item_id}", response_model=ProblemOut, dependencies=[Depends(require("problemAccess"))])
def update_problem(item_id: int, data: ProblemIn, db: DbSession):
    item = db.get(Problem, item_id)
    if item is None:
        raise NotFound("Неисправность")
    item.name = data.name.strip()
    db.commit()
    return item


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require("problemAccess"))])
def delete_problem(item_id: int, db: DbSession):
    item = db.get(Problem, item_id)
    if item is None:
        raise NotFound("Неисправность")
    db.delete(item)
    db.commit()
    return Response(status_code=204)