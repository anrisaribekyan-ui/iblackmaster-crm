"""Подсказка «для какого заказа эта запчасть»: сравнивает название карточки с открытыми заказами.

Только предлагает: привязку подтверждает сотрудник. Совпадение по модели обязательно, по детали — бонус.
"""

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Counteragent, Order, OrderStatus, StatusGroup

# Корни слов-деталей: в карточке «Дисплей для iPhone 11», в заказе «Замена дисплея» — совпадают по корню
PART_GROUPS = [
    ["дисплей", "экран", "модул", "lcd", "oled", "incell"],
    ["аккумулятор", "акб", "батаре"],
    ["стекл"],
    ["камер"],
    ["динамик"],
    ["разъ", "разъем", "зарядк"],
    ["шлейф"],
    ["корпус", "задн", "крышк"],
]
STOP = {"для", "на", "и", "с", "в", "по", "оригинал", "orig", "copy", "new", "новый", "черный", "чёрный", "белый"}


def _words(text: str) -> list[str]:
    return re.findall(r"[a-zа-яё0-9]+", text.lower().replace("ё", "е"))


def _model_tokens(text: str) -> set[str]:
    # Токены с цифрами: «a546», «bm58», «11», «13»; одиночные цифры берём только вместе с iphone/ipad рядом ниже
    return {w for w in _words(text) if any(ch.isdigit() for ch in w) and w not in STOP and len(w) >= 2}


def suggest_orders(db: Session, text: str, limit: int = 3) -> list[dict]:
    card_words = [w for w in _words(text) if w not in STOP]
    tokens = _model_tokens(text)
    if not tokens:
        return []
    card_groups = {i for i, group in enumerate(PART_GROUPS) if any(w.startswith(stem) for w in card_words for stem in group)}
    since = utcnow() - timedelta(days=90)
    rows = db.execute(
        select(Order, Counteragent.name)
        .join(Counteragent, Counteragent.id == Order.counteragent_id)
        .join(OrderStatus, OrderStatus.id == Order.status_id)
        .where(Order.is_deleted.is_(False), OrderStatus.group != StatusGroup.CLOSED, Order.created_at >= since)
        .order_by(Order.id.desc())
        .limit(400)
    ).all()
    found = []
    for order, client in rows:
        device_words = set(_words(f"{order.brand or ''} {order.model or ''}"))
        hits = [t for t in tokens if any(t == w or (len(w) >= 4 and t.startswith(w)) or (len(t) >= 4 and w.startswith(t)) for w in device_words)]
        if not hits:
            continue
        score = 3 * len(hits)
        problems = " ".join(order.problems or []).lower().replace("ё", "е")
        if any(any(stem in problems for stem in PART_GROUPS[i]) for i in card_groups):
            score += 2
        found.append({
            "order_id": order.id,
            "number": order.number,
            "device": " ".join(p for p in (order.brand, order.model) if p),
            "client": client,
            "problems": ", ".join(order.problems or []),
            "score": score,
        })
    found.sort(key=lambda item: (-item["score"], -item["order_id"]))
    return found[:limit]
