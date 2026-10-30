"""Разбор заметки «что сегодня было».

ИИ (если настроен) только вытаскивает из текста структуру: что это — продажа или выдача, что за товар/аппарат,
сколько, нал или безнал. Заказы и товары подбирает код (по словам, без ИИ), а записывает в CRM человек,
нажав «Внести». Без ключа ИИ работают простые правила.
"""

import json
import re
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Counteragent, Nomenclature, Order, OrderStatus, StatusGroup

KINDS = {"sale", "give_order", "payment", "other"}
BANK_WORDS = re.compile(r"безнал|без нал|карт[аойуе]|картой|перевод|эквайр|терминал|сбп|qr|кьюар", re.I)
CASH_WORDS = re.compile(r"наличк|наличны|\bнал\b|кэш|cash", re.I)
GIVE_WORDS = re.compile(r"выдал|выдан|выдача|отдал|забрал|закрыл", re.I)
WORK_WORDS = re.compile(r"поменял|заменил|замена|менял|починил|отремонтир|прошил|установил|восстановил|почистил|переклеил|перепаял|сделал", re.I)
NO_COST = re.compile(r"без\s+себ\w*|себ\w*\s+(?:0|ноль|нет)", re.I)
NO_WARRANTY = re.compile(r"без\s+гарант\w*", re.I)
COST = re.compile(r"(?:себес\w*|себ\w*|закуп\w*)\s*(\d{2,6})", re.I)
RETAIL = re.compile(r"(?:другому|другой|другим)\s*|(?:другому\s+)?(?:розничному\s+)?клиент\w*|в\s+розниц\w*|розничн\w*|\bего\b", re.I)
PAY_WORDS = re.compile(r"оплатил|оплата|доплат|предоплат|аванс", re.I)
FILLER = {"и", "за", "на", "по", "от", "с", "оплатили", "оплатил", "оплата", "оплачено", "руб", "р", "рублей", "клиент"}
SYNONYMS = {
    "айфон": "iphone", "айфона": "iphone", "ифон": "iphone", "самсунг": "samsung", "самсунга": "samsung",
    "редми": "redmi", "ксиоми": "xiaomi", "сяоми": "xiaomi", "хуавей": "huawei", "хонор": "honor",
    "реалми": "realme", "пова": "poco", "поко": "poco", "аймак": "imac", "макбук": "macbook",
    "айпад": "ipad", "эппл": "apple", "ремакс": "remax", "гэлакси": "galaxy", "галакси": "galaxy",
}
LOOKALIKE = str.maketrans("авекмнорстух", "abekmhopctyx")
TOKEN = re.compile(r"[a-zа-я]+|\d+")


def _tokens(text: str) -> list[str]:
    result = []
    for token in TOKEN.findall(text.lower().replace("ё", "е")):
        if token in SYNONYMS:
            token = SYNONYMS[token]
        elif re.fullmatch(r"[а-я]", token):
            token = token.translate(LOOKALIKE)
        result.append(token)
    return result


def _prefix_match(word: str, pool: set[str]) -> bool:
    """«стекл» ~ «стекло»: слова из заметки часто обрезаны или склонены."""
    if word in pool:
        return True
    if len(word) >= 4:
        return any(len(w) >= 4 and (w.startswith(word[:4]) and (w.startswith(word) or word.startswith(w[: max(4, len(w) - 2)]))) for w in pool)
    return False


def _score(query: list[str], pool: set[str]) -> float:
    if not query:
        return 0.0
    digits = [t for t in query if t.isdigit()]
    if any(t not in pool for t in digits):
        return 0.0  # «А51» не должен подходить к «А52»
    hit = sum(1 for t in query if _prefix_match(t, pool))
    return hit / len(query)


# ---------- разбор правилами ----------

def split_segments(text: str) -> list[str]:
    parts = re.split(r"[/\n;]+|\s+и\s+(?=(?:поменял|заменил|менял|починил|прошил|установил|восстановил|почистил|сделал))", text)
    return [p.strip(" \t.,") for p in parts if p.strip(" \t.,")]


def _parse_segment(segment: str) -> dict | None:
    lower = segment.lower()
    method = "bank" if BANK_WORDS.search(lower) else "cash" if CASH_WORDS.search(lower) else None
    give = bool(GIVE_WORDS.search(lower))
    paid = bool(PAY_WORDS.search(lower))
    amount = None
    lower_for_amount = COST.sub(" ", lower)
    amount_match = re.search(r"(?<![\w.])(\d{3,6})(?:\s*(?:руб\w*|р|₽)(?![а-яa-z]))?(?![\w])", lower_for_amount)
    if amount_match:
        amount = int(amount_match.group(1))
    cost_match = COST.search(lower)
    cost = int(cost_match.group(1)) if cost_match else (0 if NO_COST.search(lower) else None)
    work = bool(WORK_WORDS.search(lower)) and not give
    # Название: убираем способ оплаты, глаголы, сумму
    cleaned = COST.sub(" ", BANK_WORDS.sub(" ", lower))
    cleaned = CASH_WORDS.sub(" ", cleaned)
    cleaned = GIVE_WORDS.sub(" ", cleaned)
    no_cost = bool(NO_COST.search(lower))
    no_warranty = bool(NO_WARRANTY.search(lower))
    if work:
        cleaned = NO_COST.sub(" ", NO_WARRANTY.sub(" ", cleaned))
        cleaned = RETAIL.sub(" ", cleaned)
        cleaned = re.sub(r"\bза\b", " ", cleaned)
        cleaned = WORK_WORDS.sub(" ", cleaned)
    if amount_match:
        cleaned = cleaned.replace(amount_match.group(0), " ", 1)
    words = [w for w in _tokens(cleaned) if w not in FILLER]
    title = " ".join(words).strip()
    if not give and not paid and amount is None and method is None:
        if len(words) <= 2 and not any(w.isdigit() for w in words):
            return {"header": segment}
        return {"kind": "other", "text": segment, "title": title, "amount": None, "method": None}
    if work and not give:
        return {
            "kind": "sale", "text": segment, "title": title, "amount": amount, "method": method,
            "is_work": True, "no_cost": no_cost, "cost": cost, "guarantee_days": 0 if no_warranty else None,
        }
    if give:
        kind = "give_order"
    elif paid and amount is None:
        kind = "payment"
    else:
        kind = "sale"
    return {"kind": kind, "text": segment, "title": title, "amount": amount, "method": method}


def rules_extract(text: str) -> list[dict]:
    items, person = [], None
    for segment in split_segments(text):
        parsed = _parse_segment(segment)
        if parsed is None:
            continue
        if "header" in parsed:
            person = parsed["header"]
            continue
        parsed["person"] = person
        items.append(parsed)
    return items


# ---------- ИИ ----------

PROMPT = (
    "Ты разбираешь рабочую заметку мастера сервисного центра по ремонту телефонов за день. "
    "Раздели её на отдельные записи. Верни ТОЛЬКО JSON-массив объектов с полями: "
    '"text" (фрагмент заметки как есть), '
    '"kind": "sale" (продали товар/услугу, например стекло, чехол), "give_order" (выдали клиенту отремонтированный аппарат), '
    '"payment" (клиент внёс оплату по ремонту, но не забрал), "other" (всё прочее), '
    '"title" (что за товар или аппарат, без суммы и способа оплаты, например "Стекло Remax" или "iPhone 8"), '
    '"amount" (сумма в рублях целым числом или null), "method" ("cash" наличные, "bank" безнал/карта/перевод, или null), '
    '"person" (имя, если записи идут под чьим-то именем, иначе null), '
    '"is_work" (true, если это выполненная работа или ремонт для клиента без заказа, например «поменял дисплей розничному клиенту за 2000»: '
    'это тоже kind "sale"; false для проданного товара), '
    '"no_cost" (true, если сказано «без себеса»), "cost" (себестоимость в рублях целым числом, если названа, при «без себеса» 0, иначе null), "guarantee_days" (0 если «без гарантии», число дней если названо, иначе null). '
    'В title для работы пиши коротко, что сделано: «Замена дисплея», «Замена АКБ iPhone 8». '
    "Слова «нал» — наличные, «безнал» — безналичные. Ничего не выдумывай."
)


def llm_extract(text: str, transport: httpx.BaseTransport | None = None) -> list[dict] | None:
    if not settings.llm_api_key:
        return None
    try:
        with httpx.Client(timeout=30, transport=transport) as http:
            response = http.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                json={
                    "model": settings.llm_model,
                    "temperature": 0,
                    "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": text[:6000]}],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
        raw = json.loads(content)
        if isinstance(raw, dict):
            raw = raw.get("items") or raw.get("records") or []
        items = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            kind = row.get("kind") if row.get("kind") in KINDS else "other"
            amount = row.get("amount")
            amount = int(amount) if isinstance(amount, (int, float)) and amount > 0 else None
            method = row.get("method") if row.get("method") in ("cash", "bank") else None
            items.append({
                "kind": kind,
                "text": str(row.get("text") or row.get("title") or "")[:500],
                "title": str(row.get("title") or "")[:200],
                "amount": amount,
                "method": method,
                "person": (str(row["person"])[:100] if row.get("person") else None),
                "is_work": bool(row.get("is_work")),
                "no_cost": bool(row.get("no_cost")),
                "cost": (int(row["cost"]) if isinstance(row.get("cost"), (int, float)) and row["cost"] >= 0 else None),
                "guarantee_days": (int(row["guarantee_days"]) if isinstance(row.get("guarantee_days"), (int, float)) and row["guarantee_days"] >= 0 else None),
            })
        return items or None
    except Exception:  # сеть, формат ответа, лимиты — не повод ронять заметку, берём правила
        return None


# ---------- подбор заказов и товаров ----------

def match_orders(db: Session, title: str, allowed_locations: set[int], location_id: int | None, limit: int = 3) -> list[dict]:
    query = _tokens(title)
    if not query:
        return []
    stmt = (
        select(Order, OrderStatus, Counteragent)
        .join(OrderStatus, Order.status_id == OrderStatus.id)
        .join(Counteragent, Order.counteragent_id == Counteragent.id)
        .where(Order.is_deleted.is_(False), OrderStatus.group != StatusGroup.CLOSED)
    )
    if location_id is not None:
        stmt = stmt.where(Order.location_id == location_id)
    elif allowed_locations:
        stmt = stmt.where(Order.location_id.in_(allowed_locations))
    scored = []
    for order, status, client in db.execute(stmt).all():
        pool = set(_tokens(f"{order.brand or ''} {order.model or ''} {client.name or ''} {order.number}"))
        score = _score(query, pool)
        if score >= 0.5:
            # «iPhone 8» точнее «iPhone 8 Plus»; готовые заказы — вероятнее всего именно их выдают
            extra = len(set(_tokens(f"{order.model or ''}")) - set(query))
            scored.append((score - 0.01 * extra + (0.2 if status.group == StatusGroup.FINISH else 0), order, status, client))
    scored.sort(key=lambda row: (-row[0], -row[1].id))
    return [
        {
            "order_id": order.id,
            "location_id": order.location_id,
            "number": order.number,
            "label": " ".join(x for x in (order.brand, order.model) if x) or "Аппарат",
            "client": client.name,
            "debt": int(order.debt),
            "status": status.name,
            "ready": status.group == StatusGroup.FINISH,
        }
        for _, order, status, client in scored[:limit]
    ]


def match_products(db: Session, title: str, limit: int = 3) -> list[dict]:
    query = _tokens(title)
    if not query:
        return []
    scored = []
    for item in db.scalars(select(Nomenclature).where(Nomenclature.is_deleted.is_(False))):
        score = _score(query, set(_tokens(item.name)))
        if score >= 0.6:
            scored.append((score, item))
    scored.sort(key=lambda row: (-row[0], row[1].name))
    return [{"nomenclature_id": item.id, "name": item.name, "is_work": item.is_work} for _, item in scored[:limit]]


def analyze(
    db: Session,
    text: str,
    allowed_locations: set[int],
    location_id: int | None,
    transport: httpx.BaseTransport | None = None,
) -> tuple[list[dict], str]:
    extracted = llm_extract(text, transport)
    source = "ai"
    if extracted is None:
        extracted, source = rules_extract(text), "rules"
    items = []
    for row in extracted:
        item = {**row, "status": "new", "ref": None, "candidates": [], "products": []}
        if row["kind"] in ("give_order", "payment"):
            item["candidates"] = match_orders(db, row.get("title") or "", allowed_locations, location_id)
        elif row["kind"] == "sale":
            item["products"] = match_products(db, row.get("title") or "")
        items.append(item)
    return items, source
