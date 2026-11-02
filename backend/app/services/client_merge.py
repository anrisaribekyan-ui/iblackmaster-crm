"""Склейка задвоившихся клиентов: у «нового» телефоны склеены в одну строку, у «старого» — через запятую."""

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Counteragent
from app.models.finance import Transaction
from app.models.order import Order
from app.models.stock import Sale, StockDocument
from app.utils.phone import split_phones

def _refs():
    """(модель, поле), где хранится ссылка на клиента."""
    return [(Order, "counteragent_id"), (Transaction, "counteragent_id"), (Sale, "counteragent_id"),
            (StockDocument, "counteragent_id"), *_notification_refs()]


def _notification_refs():
    from app.models import notification

    return [(m, "counteragent_id") for m in vars(notification).values()
            if isinstance(m, type) and hasattr(m, "counteragent_id") and hasattr(m, "__table__")]


def find_pairs(db: Session) -> list[tuple[Counteragent, Counteragent]]:
    """Пары (старый, дубль): у дубля телефоны склеены, у старого тот же набор и то же имя."""
    by_phone: dict[str, list[Counteragent]] = {}
    clients = list(db.scalars(select(Counteragent).order_by(Counteragent.id)))
    for c in clients:
        for p in (c.phones or "").split(","):
            if p.strip():
                by_phone.setdefault(p.strip(), []).append(c)
    pairs = []
    for dup in clients:
        raw = dup.phones or ""
        if not raw or "," in raw or len(raw) <= 11:
            continue
        chunks = split_phones(raw)
        if len(chunks) < 2 or "".join(chunks) != raw:
            continue
        for old in by_phone.get(chunks[0], []):
            if old.id < dup.id and old.name.strip().casefold() == dup.name.strip().casefold() \
                    and set(chunks) <= {p.strip() for p in (old.phones or "").split(",")}:
                pairs.append((old, dup))
                break
    return pairs


def merge_duplicates(db: Session, commit: bool) -> dict:
    pairs = find_pairs(db)
    moved = 0
    for old, dup in pairs:
        for model, field in _refs():
            col = getattr(model, field)
            moved += db.execute(update(model).where(col == dup.id).values({field: old.id})).rowcount
        if commit:
            db.delete(dup)
    if commit:
        db.commit()
    else:
        db.rollback()
    return {"pairs": len(pairs), "references_moved": moved, "committed": commit,
            "examples": [f"{o.name} #{o.id} ← #{d.id}" for o, d in pairs[:5]]}
