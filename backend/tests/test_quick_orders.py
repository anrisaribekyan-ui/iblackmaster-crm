"""Быстрые заказы: шаблон работ, применение при создании заказа, подсказки из истории."""

from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import Counteragent, Location, Order, OrderPosition, OrderStatus, OrderType, QuickOrder, StatusGroup

TEMPLATE = {
    "name": "Замена АКБ iPhone 11",
    "brand": "Apple",
    "model": "iPhone 11",
    "problems": ["Быстро разряжается"],
    "approximate_price": "3500",
    "works": [{"name": "Замена аккумулятора", "price": 3500, "guarantee_days": 90}],
    "parts_note": "АКБ iPhone 11 (оригинальная ёмкость)",
}


def test_quick_order_fills_works_on_create(client, auth_headers, db):
    q = client.post("/api/quick-orders", json=TEMPLATE, headers=auth_headers).json()
    assert q["total"] == 3500 and client.get("/api/quick-orders", headers=auth_headers).json()[0]["id"] == q["id"]

    location = db.scalars(select(Location)).first()
    order_type = db.scalars(select(OrderType)).first()
    r = client.post("/api/orders", headers=auth_headers, json={
        "location_id": location.id, "order_type_id": order_type.id,
        "counteragent": {"name": "Иван", "phones": "79161866119"},
        "brand": "Apple", "model": "iPhone 11", "problems": ["Быстро разряжается"], "approximate_price": "3500",
        "note": "Царапина на рамке", "quick_order_id": q["id"],
        "check_in": {"Face ID": "ok", "Динамик": "fail"},
    })
    assert r.status_code == 200, r.text
    order = db.get(Order, r.json()["id"])
    db.refresh(order)
    positions = db.scalars(select(OrderPosition).where(OrderPosition.order_id == order.id)).all()
    assert [(p.name, int(p.price), p.guarantee_days, p.is_work) for p in positions] == [("Замена аккумулятора", 3500, 90, True)]
    assert int(order.total_price) == 3500
    assert order.note == "Царапина на рамке\nЗапчасть: АКБ iPhone 11 (оригинальная ёмкость)"
    assert order.check_in == {"Face ID": "ok", "Динамик": "fail"}
    assert db.get(QuickOrder, q["id"]).uses == 1


def test_suggestions_from_history_skip_existing(client, auth_headers, db, owner):
    client_ = Counteragent(name="Клиент")
    db.add(client_)
    db.flush()
    closed = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.CLOSED)).first()
    loc = db.scalars(select(Location)).first()
    otype = db.scalars(select(OrderType)).first()
    for i, (model, work, price) in enumerate(
        [("iPhone 11", "Замена дисплея", 6500)] * 4 + [("iPhone 11", "Замена аккумулятора", 3500)] * 3 + [("Redmi 9", "Замена гнезда", 1500)] * 2
    ):
        o = Order(number=f"H{i}", location_id=loc.id, order_type_id=otype.id, counteragent_id=client_.id, status_id=closed.id,
                  created_by_id=owner.id, brand="Apple", model=model, closed_at=utcnow() - timedelta(days=10), total_price=price)
        db.add(o)
        db.flush()
        db.add(OrderPosition(order_id=o.id, name=work, is_work=True, price=price, sold_price=price, guarantee_days=30))
    db.commit()
    client.post("/api/quick-orders", json=TEMPLATE | {"works": [{"name": "замена  аккумулятора", "price": 3500}]}, headers=auth_headers)

    items = client.get("/api/quick-orders/suggestions", headers=auth_headers).json()
    assert [(i["name"], i["price"], i["count"], i["guarantee_days"]) for i in items] == [("Замена дисплея iPhone 11", 6500, 4, 30)]
