"""Идеи для владельца. Писать может любой сотрудник, читать и разбирать — только владелец."""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession
from app.errors import BusinessError, Forbidden, NotFound
from app.models import Employee, Idea

router = APIRouter(prefix="/ideas", tags=["Идеи для Анри"])


class IdeaIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    page: str | None = Field(default=None, max_length=300)


class IdeaUpdate(BaseModel):
    status: str | None = Field(default=None, pattern="^(new|done|dismissed)$")
    note: str | None = Field(default=None, max_length=5000)


def serialize(idea: Idea, author: str) -> dict:
    return {
        "id": idea.id,
        "author": author,
        "text": idea.text,
        "page": idea.page,
        "status": idea.status,
        "note": idea.note,
        "created_at": idea.created_at,
    }


def owner_only(me: Employee) -> None:
    if not me.is_owner:
        raise Forbidden()


@router.post("", status_code=201)
def create_idea(data: IdeaIn, db: DbSession, me: CurrentEmployee):
    text = data.text.strip()
    if not text:
        raise BusinessError("Напишите идею")
    idea = Idea(author_id=me.id, text=text, page=data.page)
    db.add(idea)
    db.commit()
    return serialize(idea, me.short_name)


@router.get("")
def list_ideas(db: DbSession, me: CurrentEmployee, status: str | None = None):
    owner_only(me)
    query = select(Idea, Employee.short_name).join(Employee, Employee.id == Idea.author_id).order_by(Idea.id.desc())
    if status:
        query = query.where(Idea.status == status)
    rows = db.execute(query.limit(500)).all()
    new_count = len(db.scalars(select(Idea.id).where(Idea.status == "new")).all())
    return {"items": [serialize(i, name) for i, name in rows], "new": new_count}


@router.get("/count")
def count_new(db: DbSession, me: CurrentEmployee):
    if not me.is_owner:
        return {"new": 0}
    return {"new": len(db.scalars(select(Idea.id).where(Idea.status == "new")).all())}


@router.put("/{idea_id}")
def update_idea(idea_id: int, data: IdeaUpdate, db: DbSession, me: CurrentEmployee):
    owner_only(me)
    idea = db.get(Idea, idea_id)
    if idea is None:
        raise NotFound("Идея")
    if data.status is not None:
        idea.status = data.status
    if data.note is not None:
        idea.note = data.note.strip() or None
    db.commit()
    author = db.get(Employee, idea.author_id)
    return serialize(idea, author.short_name if author else "")
