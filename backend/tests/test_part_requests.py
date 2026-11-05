from sqlalchemy import select

from app.models import Location, OrderHistory, OrderType
from tests.test_orders import order_payload


def make_order(client, auth_headers, db, brand="Samsung", model="A546", problems=None):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    payload = order_payload(location.id, order_type.id, {"name": "Овсепян Гаяне"})
    payload["brand"], payload["model"] = brand, model
    payload["problems"] = problems or ["Замена АКБ"]
    created = client.post("/api/orders", json=payload, headers=auth_headers)
    assert created.status_code == 200, created.text
    return created.json()


def test_link_part_to_order_and_history(client, auth_headers, db):
    order = make_order(client, auth_headers, db)
    body = {"doska_id": "abc123", "text": "Аккумулятор Samsung A546", "shop": "Art-GSM", "price": "550", "purpose": "order", "order_id": order["id"]}
    r = client.post("/api/part-requests", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["order_number"] == order["number"]
    listed = client.get("/api/part-requests", params={"order_id": order["id"]}, headers=auth_headers).json()
    assert [i["shop"] for i in listed["items"]] == ["Art-GSM"]
    texts = [h.text for h in db.scalars(select(OrderHistory).where(OrderHistory.order_id == order["id"]))]
    assert any(t and "Заказана запчасть" in t and "Art-GSM" in t for t in texts)
    # повторное сохранение той же карточки не дублирует запись в истории
    client.post("/api/part-requests", json=body, headers=auth_headers)
    texts = [h.text for h in db.scalars(select(OrderHistory).where(OrderHistory.order_id == order["id"]))]
    assert sum(1 for t in texts if t and "Заказана запчасть" in t) == 1


def test_stock_purpose_needs_no_order_but_order_purpose_does(client, auth_headers, db):
    ok = client.post("/api/part-requests", json={"doska_id": "s1", "text": "Дисплей iPhone 5", "purpose": "stock_sale"}, headers=auth_headers)
    assert ok.status_code == 200 and ok.json()["order_id"] is None
    bad = client.post("/api/part-requests", json={"doska_id": "s2", "text": "Дисплей", "purpose": "order"}, headers=auth_headers)
    assert bad.status_code == 400


def test_suggest_matches_model_and_part(client, auth_headers, db):
    match = make_order(client, auth_headers, db, "Samsung", "A546", ["Замена АКБ"])
    make_order(client, auth_headers, db, "Apple", "iPhone 11", ["Замена дисплея"])
    r = client.post("/api/part-requests/suggest", json={"text": "Аккумулятор (АКБ) Samsung Galaxy A25/A34/A546E"}, headers=auth_headers).json()
    assert r["items"][0]["number"] == match["number"]  # «A546E» из списка моделей в названии подходит к «A546»
    r = client.post("/api/part-requests/suggest", json={"text": "Аккумулятор для Samsung A546"}, headers=auth_headers).json()
    assert r["items"][0]["number"] == match["number"]
    assert r["items"][0]["score"] >= 5
    none = client.post("/api/part-requests/suggest", json={"text": "Чехол универсальный"}, headers=auth_headers).json()
    assert none["items"] == []


def test_linked_lookup(client, auth_headers, db):
    order = make_order(client, auth_headers, db)
    client.post("/api/part-requests", json={"doska_id": "zz9", "text": "x", "purpose": "order", "order_number": order["number"][1:]}, headers=auth_headers)
    got = client.get("/api/part-requests/linked", params={"doska_ids": "zz9,nope"}, headers=auth_headers).json()["items"]
    assert got["zz9"]["order_number"] == order["number"] and "nope" not in got
