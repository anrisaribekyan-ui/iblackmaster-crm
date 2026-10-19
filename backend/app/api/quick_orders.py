"""Быстрые заказы (ТЗ этап 3, E3): частые ремонты одной кнопкой на приёмке.

Список для приёмки видят все, кто принимает заказы; редактирует — у кого есть доступ к настройкам.
«Подсказки» строятся по истории: какие работы на какой модели делали чаще всего за год и сколько это стоило.
"""

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.counteragents import require_order_read
from app.api.deps import CurrentEmployee, DbSession, require
from app.errors import NotFound
from app.models import Order, OrderPosition, QuickOrder
from app.services.orders import add_position

router = APIRouter(prefix="/quick-orders", tags=["Быстрые заказы"])


class WorkIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    price: int = Field(ge=0, le=10_000_000)
    guarantee_days: int = Field(default=0, ge=0, le=3650)


class QuickOrderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    device_type: str | None = Field(default=None, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=200)
    problems: list[str] = Field(default_factory=list, max_length=10)
    approximate_price: str | None = Field(default=None, max_length=100)
    works: list[WorkIn] = Field(default_factory=list, max_length=10)
    parts_note: str | None = Field(default=None, max_length=300)
    sort: int = 0
    is_active: bool = True


def quick_dict(q: QuickOrder) -> dict:
    return {
        "id": q.id,
        "name": q.name,
        "device_type": q.device_type,
        "brand": q.brand,
        "model": q.model,
        "problems": q.problems or [],
        "approximate_price": q.approximate_price,
        "works": q.works or [],
        "parts_note": q.parts_note,
        "total": sum(int(w.get("price") or 0) for w in (q.works or [])),
        "sort": q.sort,
        "uses": q.uses,
        "is_active": q.is_active,
    }


@router.get("")
def list_quick_orders(db: DbSession, me: CurrentEmployee, all: bool = False):
    require_order_read(me)
    query = select(QuickOrder)
    if not all:
        query = query.where(QuickOrder.is_active.is_(True))
    items = db.scalars(query.order_by(QuickOrder.sort, QuickOrder.uses.desc(), QuickOrder.name)).all()
    return [quick_dict(q) for q in items]


def _apply(q: QuickOrder, data: QuickOrderIn) -> None:
    for key, value in data.model_dump().items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(q, key, value)
    q.problems = [p.strip() for p in data.problems if p.strip()]
    q.works = [w.model_dump() | {"name": w.name.strip()} for w in data.works]


@router.post("", dependencies=[Depends(require("settingAccess"))])
def create_quick_order(data: QuickOrderIn, db: DbSession):
    q = QuickOrder(name=data.name)
    _apply(q, data)
    db.add(q)
    db.commit()
    return quick_dict(q)


@router.put("/{quick_id}", dependencies=[Depends(require("settingAccess"))])
def update_quick_order(quick_id: int, data: QuickOrderIn, db: DbSession):
    q = db.get(QuickOrder, quick_id)
    if q is None:
        raise NotFound("Быстрый заказ")
    _apply(q, data)
    db.commit()
    return quick_dict(q)


@router.delete("/{quick_id}", status_code=204, dependencies=[Depends(require("settingAccess"))])
def delete_quick_order(quick_id: int, db: DbSession):
    q = db.get(QuickOrder, quick_id)
    if q is None:
        raise NotFound("Быстрый заказ")
    db.delete(q)
    db.commit()


def _key(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip(" .,")


@router.get("/suggestions", dependencies=[Depends(require("settingAccess"))])
def suggestions(db: DbSession, limit: int = 20):
    """Частые ремонты за год: модель + работа, сколько раз, обычная цена работы и гарантия.
    Уже заведённые быстрые заказы (та же модель и та же работа) не предлагаем."""
    since = datetime.now(timezone.utc) - timedelta(days=365)
    rows = db.execute(
        select(Order.brand, Order.model, Order.device_type, OrderPosition.name, OrderPosition.sold_price, OrderPosition.guarantee_days)
        .join(OrderPosition, OrderPosition.order_id == Order.id)
        .where(
            Order.is_deleted.is_(False),
            Order.closed_at.is_not(None),
            Order.closed_at >= since,
            Order.model.is_not(None),
            OrderPosition.is_work.is_(True),
            OrderPosition.sold_price > 0,
        )
    ).all()
    existing = {
        (_key(q.model), _key(w.get("name")))
        for q in db.scalars(select(QuickOrder))
        for w in (q.works or [])
    }
    groups: dict[tuple, dict] = defaultdict(lambda: {"prices": [], "guarantees": Counter(), "brands": Counter(), "types": Counter(), "names": Counter()})
    for brand, model, device_type, name, price, guarantee in rows:
        key = (_key(model), _key(name))
        if not key[0] or key in existing:
            continue
        g = groups[key]
        g["prices"].append(int(price))
        g["guarantees"][guarantee or 0] += 1
        g["brands"][(brand or "").strip()] += 1
        g["types"][(device_type or "").strip()] += 1
        g["names"][(model.strip(), name.strip())] += 1
    result = []
    for g in groups.values():
        if len(g["prices"]) < 3:
            continue
        (model, work), _ = g["names"].most_common(1)[0]
        brand = g["brands"].most_common(1)[0][0] or None
        price = int(round(median(g["prices"]) / 100.0) * 100)
        result.append(
            {
                "name": f"{work} {model}",
                "brand": brand,
                "model": model,
                "device_type": g["types"].most_common(1)[0][0] or None,
                "work": work,
                "price": price,
                "guarantee_days": g["guarantees"].most_common(1)[0][0],
                "count": len(g["prices"]),
            }
        )
    result.sort(key=lambda r: -r["count"])
    return result[:limit]


def apply_to_order(db, order: Order, quick_id: int, employee) -> None:
    """Вызывается при создании заказа: добавляет работы шаблона и заметку о запчасти мастеру."""
    q = db.get(QuickOrder, quick_id)
    if q is None or not q.is_active:
        raise NotFound("Быстрый заказ")
    for work in q.works or []:
        add_position(
            db,
            order,
            employee,
            name=work["name"],
            is_work=True,
            price=work.get("price") or 0,
            guarantee_days=int(work.get("guarantee_days") or 0),
            performer_id=order.master_id,
        )
    if q.parts_note:
        note = f"Запчасть: {q.parts_note}"
        order.note = f"{order.note}\n{note}" if order.note else note
    q.uses += 1
