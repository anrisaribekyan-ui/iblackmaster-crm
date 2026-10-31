"""Восстановление гарантии на позициях перенесённых заказов."""

from datetime import datetime

from sqlalchemy import select

from app.importers.livesklad_guarantee import run
from app.importers.livesklad_orders import MSK
from app.models import Counteragent, Location, Nomenclature, Order, OrderPosition, OrderStatus, OrderType


def test_guarantee_rule(db, owner):
    location = db.scalars(select(Location)).first()
    client = Counteragent(name="Клиент")
    db.add(client)
    db.flush()
    order = Order(number="G1", location_id=location.id, order_type_id=db.scalars(select(OrderType)).first().id,
                  counteragent_id=client.id, status_id=db.scalars(select(OrderStatus)).first().id, created_by_id=owner.id,
                  total_price=0, paid=0)
    db.add(order)
    db.flush()
    db.add(Nomenclature(code=990001, name="Стекло Samsung", guarantee_days=14))
    db.add_all([
        OrderPosition(order_id=order.id, is_work=True, name="Замена дисплея", quantity=1, price=1, sold_price=1, guarantee_days=0),
        OrderPosition(order_id=order.id, is_work=False, name="стекло samsung", quantity=1, price=1, sold_price=1, guarantee_days=0),
        OrderPosition(order_id=order.id, is_work=False, name="Что-то новое", quantity=1, price=1, sold_price=1, guarantee_days=0),
        OrderPosition(order_id=order.id, is_work=True, name="Правленная вручную", quantity=1, price=1, sold_price=1, guarantee_days=30),
    ])
    db.commit()
    assert run(db, commit=True, cutover=datetime(2099, 1, 1, tzinfo=MSK)) == 0
    days = {p.name: p.guarantee_days for p in db.scalars(select(OrderPosition))}
    assert days == {"Замена дисплея": 90, "стекло samsung": 14, "Что-то новое": 90, "Правленная вручную": 30}
