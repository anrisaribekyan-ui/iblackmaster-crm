"""Догрузка четырёх свежих заказов LiveSklad."""

from sqlalchemy import select

from app.importers.livesklad_fresh import add_missing
from app.models import Order


def test_add_missing_is_idempotent(db, owner):
    assert add_missing(db) == 4
    db.commit()
    orders = {o.number: o for o in db.scalars(select(Order))}
    assert {"A15977", "A15978", "A15979", "A15980"} <= set(orders)
    first = orders["A15980"]
    assert first.status.name == "Принят" and first.approximate_price == "2700"
    assert first.appearance == ["царапины", "потертости"] and first.problems == ["Не заряжается"]
    assert first.counteragent.name == "Елена"
    first.note = "правка в CRM"
    db.commit()
    assert add_missing(db) == 0
    assert db.scalars(select(Order).where(Order.number == "A15980")).one().note == "правка в CRM"
