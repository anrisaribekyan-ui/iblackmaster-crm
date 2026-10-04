"""ОБРАЗЕЦ CRUD-роутера. Новые справочники делай по этому шаблону.

Схема:
- Pydantic-схемы In/Out рядом с роутером (или в app/schemas/, если используются в нескольких местах).
- Права — через Depends(require(...)).
- Ошибки — BusinessError / NotFound, никаких HTTPException с английским текстом.
- Удаление справочников — мягкое (is_active=False), чтобы не ломать старые заказы.
- commit делает роутер, сервисы только flush.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import NotFound
from app.models import HowKnow

router = APIRouter(prefix="/how-knows", tags=["Справочники"])


class HowKnowIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class HowKnowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_active: bool


@router.get("", response_model=list[HowKnowOut])
def list_how_knows(db: DbSession, _: CurrentEmployee, include_inactive: bool = False):
    q = select(HowKnow).order_by(HowKnow.name)
    if not include_inactive:
        q = q.where(HowKnow.is_active.is_(True))
    return db.scalars(q).all()


@router.post("", response_model=HowKnowOut, dependencies=[Depends(require("howKnowAccess"))])
def create_how_know(data: HowKnowIn, db: DbSession):
    item = HowKnow(name=data.name.strip())
    db.add(item)
    db.commit()
    return item


@router.put("/{item_id}", response_model=HowKnowOut, dependencies=[Depends(require("howKnowAccess"))])
def update_how_know(item_id: int, data: HowKnowIn, db: DbSession):
    item = db.get(HowKnow, item_id)
    if item is None:
        raise NotFound("Рекламный источник")
    item.name = data.name.strip()
    db.commit()
    return item


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require("howKnowAccess"))])
def delete_how_know(item_id: int, db: DbSession):
    item = db.get(HowKnow, item_id)
    if item is None:
        raise NotFound("Рекламный источник")
    item.is_active = False
    db.commit()
