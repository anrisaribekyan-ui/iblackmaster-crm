"""Заказанные запчасти: связь карточки «Что купить» (Доска) с заказом или с пополнением склада."""

from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession
from app.api.orders import assert_order_access
from app.errors import BusinessError, NotFound
from app.models import Order, PartRequest
from app.services import orders as order_service
from app.services import part_requests as service

router = APIRouter(prefix="/part-requests", tags=["Заказ запчастей"])

PURPOSES = {"order": "под заказ", "stock_order": "пополнить склад (потрачено в заказе)", "stock_sale": "пополнить склад (продано)", "other": "другое"}


class PartRequestIn(BaseModel):
    doska_id: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=500)
    shop: str | None = Field(default=None, max_length=100)
    price: Decimal | None = None
    purpose: str = Field(default="order", pattern="^(order|stock_order|stock_sale|other)$")
    order_id: int | None = None
    order_number: str | None = Field(default=None, max_length=20)
    suggested: bool = False


class SuggestIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


def serialize(item: PartRequest, number: str | None) -> dict:
    return {
        "id": item.id,
        "doska_id": item.doska_id,
        "order_id": item.order_id,
        "order_number": number,
        "text": item.text,
        "shop": item.shop,
        "price": item.price,
        "purpose": item.purpose,
        "purpose_label": PURPOSES.get(item.purpose, item.purpose),
        "suggested": item.suggested,
        "created_at": item.created_at,
    }


def _find_order(db: DbSession, data: PartRequestIn, me: CurrentEmployee) -> Order | None:
    order = None
    if data.order_id:
        order = db.get(Order, data.order_id)
    elif data.order_number:
        number = data.order_number.strip().replace(" ", "")
        number = "A" + number[1:] if number[:1] in ("А", "а", "a", "A") else "A" + number
        order = db.scalars(select(Order).where(Order.number == number)).first()
    if (data.order_id or data.order_number) and (order is None or order.is_deleted):
        raise NotFound("Заказ")
    if order is not None:
        assert_order_access(order, me)
    return order


@router.post("")
def save_part_request(data: PartRequestIn, db: DbSession, me: CurrentEmployee):
    """Создаёт или обновляет запись по карточке Доски. В историю заказа пишется, что запчасть заказана."""
    order = _find_order(db, data, me)
    if data.purpose == "order" and order is None:
        raise BusinessError("Выберите заказ")
    item = db.scalars(select(PartRequest).where(PartRequest.doska_id == data.doska_id)).first()
    previous_order_id = item.order_id if item else None
    if item is None:
        item = PartRequest(doska_id=data.doska_id, text=data.text.strip(), employee_id=me.id)
        db.add(item)
    item.text = data.text.strip()
    item.shop = data.shop or item.shop
    item.price = data.price if data.price is not None else item.price
    item.purpose = data.purpose
    item.order_id = order.id if order else None
    item.suggested = data.suggested
    db.flush()
    if order is not None and previous_order_id != order.id:
        kind = PURPOSES.get(data.purpose, data.purpose)
        details = ", ".join(x for x in (item.shop, f"{item.price:g} руб" if item.price is not None else None) if x)
        order_service.add_history(db, order, "comment", me, text=f"Заказана запчасть ({kind}): {item.text}" + (f" — {details}" if details else ""))
    db.commit()
    return serialize(item, order.number if order else None)


@router.get("")
def list_for_order(order_id: int, db: DbSession, me: CurrentEmployee):
    order = db.get(Order, order_id)
    if order is None or order.is_deleted:
        raise NotFound("Заказ")
    assert_order_access(order, me)
    items = db.scalars(select(PartRequest).where(PartRequest.order_id == order_id).order_by(PartRequest.id)).all()
    return {"items": [serialize(i, order.number) for i in items]}


@router.get("/linked")
def linked(doska_ids: str, db: DbSession, me: CurrentEmployee):
    """Для списка карточек Доски: к чему уже привязаны (чтобы не предлагать повторно)."""
    ids = [x for x in doska_ids.split(",") if x][:200]
    if not ids:
        return {"items": {}}
    rows = db.execute(
        select(PartRequest, Order.number).outerjoin(Order, Order.id == PartRequest.order_id).where(PartRequest.doska_id.in_(ids))
    ).all()
    return {"items": {r.doska_id: {"order_id": r.order_id, "order_number": number, "purpose": r.purpose, "purpose_label": PURPOSES.get(r.purpose, r.purpose)} for r, number in rows}}


@router.post("/suggest")
def suggest(data: SuggestIn, db: DbSession, me: CurrentEmployee):
    """Какие открытые заказы похожи на эту запчасть. Только подсказка: привязку подтверждает сотрудник."""
    items = [i for i in service.suggest_orders(db, data.text)]
    visible = []
    for item in items:
        order = db.get(Order, item["order_id"])
        try:
            assert_order_access(order, me)
        except Exception:
            continue
        visible.append(item)
    return {"items": visible}
