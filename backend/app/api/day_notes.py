"""Заметка «что сегодня было»: свободный текст за день → ИИ → предложения внести в заказы и продажи.

Сам ИИ ничего не записывает: фронт вносит выбранное обычными методами заказов и продаж (с их правами и проверками),
а здесь только помечается, что запись внесена или пропущена.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, check_location, location_ids
from app.config import settings
from app.db import utcnow
from app.errors import BusinessError, Forbidden, NotFound
from app.models import DayNote
from app.services import day_notes as service

router = APIRouter(prefix="/day-notes", tags=["Что сегодня было"])


class NoteIn(BaseModel):
    text: str = Field(max_length=20000)
    location_id: int | None = None
    note_date: date | None = None


class NoteText(BaseModel):
    text: str = Field(max_length=20000)


class ItemMark(BaseModel):
    status: str = Field(pattern="^(new|applied|skipped)$")
    ref: str | None = Field(default=None, max_length=100)  # например «order:15» или «sale:Ч-7»


def today() -> date:
    from datetime import timedelta

    return (datetime.now(timezone.utc) + timedelta(minutes=settings.company_utc_offset_minutes)).date()


def serialize(note: DayNote) -> dict:
    return {
        "id": note.id,
        "location_id": note.location_id,
        "author_id": note.author_id,
        "note_date": note.note_date.isoformat(),
        "text": note.text,
        "items": note.items or [],
        "analyzed_at": note.analyzed_at,
        "analyzed_by": note.analyzed_by,
        "ai_enabled": bool(settings.llm_api_key),
        "updated_at": note.updated_at,
    }


def get_note(db: DbSession, me: CurrentEmployee, note_id: int) -> DayNote:
    note = db.get(DayNote, note_id)
    if note is None:
        raise NotFound("Заметка")
    if note.location_id is not None:
        check_location(me, note.location_id)
    return note


@router.get("")
def list_notes(db: DbSession, me: CurrentEmployee, note_date: date | None = None, location_id: int | None = None):
    query = select(DayNote).where(DayNote.note_date == (note_date or today()))
    allowed = location_ids(me)
    if location_id is not None:
        check_location(me, location_id)
        query = query.where(DayNote.location_id == location_id)
    elif allowed:
        query = query.where(DayNote.location_id.in_(allowed) | DayNote.location_id.is_(None))
    notes = db.scalars(query.order_by(DayNote.id)).all()
    return {"ai_enabled": bool(settings.llm_api_key), "items": [serialize(n) for n in notes]}


@router.post("")
def create_note(data: NoteIn, db: DbSession, me: CurrentEmployee):
    if data.location_id is not None:
        check_location(me, data.location_id)
    note = DayNote(
        location_id=data.location_id,
        author_id=me.id,
        note_date=data.note_date or today(),
        text=data.text.strip(),
        items=[],
    )
    db.add(note)
    db.commit()
    return serialize(note)


@router.put("/{note_id}")
def update_note(note_id: int, data: NoteText, db: DbSession, me: CurrentEmployee):
    note = get_note(db, me, note_id)
    if note.author_id != me.id and not me.is_owner:
        raise Forbidden("Чужую заметку менять нельзя")
    note.text = data.text.strip()
    db.commit()
    return serialize(note)


@router.delete("/{note_id}")
def delete_note(note_id: int, db: DbSession, me: CurrentEmployee):
    note = get_note(db, me, note_id)
    if note.author_id != me.id and not me.is_owner:
        raise Forbidden("Чужую заметку удалять нельзя")
    db.delete(note)
    db.commit()
    return {"ok": True}


@router.post("/{note_id}/analyze")
def analyze_note(note_id: int, db: DbSession, me: CurrentEmployee):
    note = get_note(db, me, note_id)
    if not note.text.strip():
        raise BusinessError("Заметка пустая — сначала напишите, что было")
    items, source = service.analyze(db, note.text, location_ids(me), note.location_id)
    # Что уже внесли или пропустили — не возвращаем «новым», если запись с тем же текстом осталась
    done = {i["text"]: i for i in (note.items or []) if i.get("status") in ("applied", "skipped")}
    for item in items:
        previous = done.get(item["text"])
        if previous:
            item["status"], item["ref"] = previous["status"], previous.get("ref")
    note.items = items
    note.analyzed_at = utcnow()
    note.analyzed_by = source
    db.commit()
    return serialize(note)


@router.patch("/{note_id}/items/{index}")
def mark_item(note_id: int, index: int, data: ItemMark, db: DbSession, me: CurrentEmployee):
    note = get_note(db, me, note_id)
    items = list(note.items or [])
    if not 0 <= index < len(items):
        raise NotFound("Запись заметки")
    items[index] = {**items[index], "status": data.status, "ref": data.ref}
    note.items = items  # новый список — иначе SQLAlchemy не заметит изменения JSON
    db.commit()
    return serialize(note)
