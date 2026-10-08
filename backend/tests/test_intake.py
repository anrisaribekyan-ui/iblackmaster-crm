"""Приёмка: узнавание клиента (C1) и гарантия на лету (C2)."""

from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import Counteragent, Location, Order, OrderPosition, OrderStatus, OrderType, StatusGroup


def make_order(db, owner, client, number, *, days_ago, closed=True, serial=None, model="iPhone 13", positions=(), total=3000):
    loc = db.scalars(select(Location)).first()
    group = StatusGroup.CLOSED if closed else StatusGroup.IN_WORK
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == group)).first()
    when = utcnow() - timedelta(days=days_ago)
    o = Order(number=number, location_id=loc.id, order_type_id=db.scalars(select(OrderType)).first().id, counteragent_id=client.id,
              status_id=status.id, created_by_id=owner.id, brand="Apple", model=model, serial=serial, total_price=total,
              paid=total, created_at=when, closed_at=when if closed else None)
    db.add(o)
    db.flush()
    for name, days in positions:
        db.add(OrderPosition(order_id=o.id, name=name, is_work=True, price=1000, sold_price=1000, guarantee_days=days))
    db.flush()
    return o


def test_client_recognition(client, auth_headers, db, owner):
    ivan = Counteragent(name="Иван Петров", phones="79161866119", balance=-1500)
    db.add(ivan)
    db.flush()
    make_order(db, owner, ivan, "A1", days_ago=400, model="iPhone 8")
    make_order(db, owner, ivan, "A2", days_ago=200)
    make_order(db, owner, ivan, "A3", days_ago=95, positions=[("Замена дисплея", 0)])
    make_order(db, owner, ivan, "A4", days_ago=1, closed=False)
    db.commit()
    body = client.get(f"/api/intake/hints?counteragent_id={ivan.id}", headers=auth_headers).json()
    c = body["client"]
    assert c["visits"] == 4 and c["is_regular"] and c["open_orders"] == 1 and c["debt"] == 1500
    assert c["last"]["number"] == "A4" and c["spent"] == 9000
    assert body["warranty"] == []  # ни серийника, ни модели не передали


def test_warranty_by_serial_and_by_model(client, auth_headers, db, owner):
    ivan = Counteragent(name="Иван", phones="79161866119")
    other = Counteragent(name="Пётр", phones="79160000000")
    db.add_all([ivan, other])
    db.flush()
    make_order(db, owner, other, "B1", days_ago=20, serial="35 412345 678901 2", positions=[("Замена дисплея", 90), ("Чистка", 0)])
    make_order(db, owner, ivan, "B2", days_ago=40, model="iPhone 11", positions=[("Замена АКБ", 30)])  # гарантия истекла 10 дней назад
    make_order(db, owner, ivan, "B3", days_ago=300, model="iPhone 11", positions=[("Замена АКБ", 365)])
    db.commit()

    # IMEI набран слитно — находим, хотя аппарат принадлежал другому клиенту
    hints = client.get("/api/intake/hints?serial=354123456789012", headers=auth_headers).json()
    assert [w["number"] for w in hints["warranty"]] == ["B1"]
    w = hints["warranty"][0]
    assert w["kind"] == "warranty" and w["match"] == "serial" and [c["name"] for c in w["covered"]] == ["Замена дисплея"]
    assert hints["warranty_order_type_id"] is not None

    # Клиент + модель: годовая гарантия на АКБ (B3) важнее, истёкшая B2 — лишь «повторное обращение»
    hints = client.get(f"/api/intake/hints?counteragent_id={ivan.id}&brand=apple&model=iPhone%2011", headers=auth_headers).json()
    assert [(w["number"], w["kind"]) for w in hints["warranty"]] == [("B3", "warranty"), ("B2", "repeat")]

    # Другая модель того же клиента — ничего
    hints = client.get(f"/api/intake/hints?counteragent_id={ivan.id}&brand=Apple&model=iPhone%2015", headers=auth_headers).json()
    assert hints["warranty"] == []
