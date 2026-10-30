import json

import httpx
from sqlalchemy import select

from app.config import settings
from app.models import Counteragent, Location, Nomenclature, Order, OrderStatus, OrderType, StatusGroup
from app.services import day_notes as service

NOTE = "Аля / Стекло 700 ремакс. Нал / Айфон8 выдал оплатили безнал / А51 выдал нал"


def make_order(db, owner, number, brand, model, status_group=StatusGroup.FINISH, price=1000):
    client = Counteragent(name=f"Клиент {number}")
    db.add(client)
    db.flush()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == status_group)).first()
    order = Order(
        number=number, location_id=db.scalars(select(Location)).first().id,
        order_type_id=db.scalars(select(OrderType)).first().id, counteragent_id=client.id,
        status_id=status.id, created_by_id=owner.id, brand=brand, model=model, total_price=price,
    )
    db.add(order)
    db.commit()
    return order


def test_rules_split_example_note():
    items = service.rules_extract(NOTE)
    assert [(i["kind"], i["title"], i["amount"], i["method"], i["person"]) for i in items] == [
        ("sale", "стекло remax", 700, "cash", "Аля"),
        ("give_order", "iphone 8", None, "bank", "Аля"),
        ("give_order", "a 51", None, "cash", "Аля"),
    ]


def test_analyze_matches_orders_and_products(client, auth_headers, db, owner):
    iphone8 = make_order(db, owner, "T1", "Apple", "iPhone 8", price=3000)
    make_order(db, owner, "T2", "Apple", "iPhone 8 Plus")
    a51 = make_order(db, owner, "T3", "Samsung", "A51")
    make_order(db, owner, "T4", "Samsung", "A52")
    db.add(Nomenclature(code=770001, name="Стекло защитное Remax"))
    db.commit()

    created = client.post("/api/day-notes", json={"text": NOTE}, headers=auth_headers)
    assert created.status_code == 200, created.text
    note_id = created.json()["id"]
    result = client.post(f"/api/day-notes/{note_id}/analyze", headers=auth_headers).json()
    assert result["analyzed_by"] == "rules"
    sale, give8, give51 = result["items"]
    assert sale["products"][0]["name"] == "Стекло защитное Remax"
    assert [c["order_id"] for c in give8["candidates"]][0] == iphone8.id
    assert iphone8.id in [c["order_id"] for c in give8["candidates"]] and give8["candidates"][0]["debt"] == 3000
    assert [c["order_id"] for c in give51["candidates"]] == [a51.id]  # А52 не подходит к А51


def test_closed_orders_are_not_offered(client, auth_headers, db, owner):
    make_order(db, owner, "T9", "Samsung", "A51", status_group=StatusGroup.CLOSED)
    note_id = client.post("/api/day-notes", json={"text": "А51 выдал нал"}, headers=auth_headers).json()["id"]
    item = client.post(f"/api/day-notes/{note_id}/analyze", headers=auth_headers).json()["items"][0]
    assert item["candidates"] == []


def test_mark_items_and_keep_done_on_reanalyze(client, auth_headers, db, owner):
    make_order(db, owner, "T5", "Samsung", "A51")
    note_id = client.post("/api/day-notes", json={"text": "А51 выдал нал"}, headers=auth_headers).json()["id"]
    client.post(f"/api/day-notes/{note_id}/analyze", headers=auth_headers)
    marked = client.patch(f"/api/day-notes/{note_id}/items/0", json={"status": "applied", "ref": "order:T5"}, headers=auth_headers)
    assert marked.status_code == 200 and marked.json()["items"][0]["status"] == "applied"
    again = client.post(f"/api/day-notes/{note_id}/analyze", headers=auth_headers).json()
    assert again["items"][0]["status"] == "applied" and again["items"][0]["ref"] == "order:T5"
    assert client.patch(f"/api/day-notes/{note_id}/items/5", json={"status": "skipped"}, headers=auth_headers).status_code == 404


def test_notes_list_update_delete(client, auth_headers):
    note = client.post("/api/day-notes", json={"text": "  первая  "}, headers=auth_headers).json()
    assert note["text"] == "первая"
    client.put(f"/api/day-notes/{note['id']}", json={"text": "вторая"}, headers=auth_headers)
    listed = client.get("/api/day-notes", headers=auth_headers).json()
    assert [n["text"] for n in listed["items"]] == ["вторая"] and listed["ai_enabled"] is False
    assert client.delete(f"/api/day-notes/{note['id']}", headers=auth_headers).status_code == 200
    assert client.get("/api/day-notes", headers=auth_headers).json()["items"] == []
    assert client.post("/api/day-notes/999/analyze", headers=auth_headers).status_code == 404


def test_empty_note_cannot_be_analyzed(client, auth_headers):
    note_id = client.post("/api/day-notes", json={"text": ""}, headers=auth_headers).json()["id"]
    assert client.post(f"/api/day-notes/{note_id}/analyze", headers=auth_headers).status_code == 400


def test_llm_answer_is_used_and_garbage_falls_back(monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "k")
    good = [{"text": "Стекло 700", "kind": "sale", "title": "Стекло", "amount": 700, "method": "cash", "person": None},
            {"text": "?", "kind": "weird", "amount": -5, "method": "gold"}]

    def reply(content):
        return httpx.MockTransport(lambda req: httpx.Response(200, json={"choices": [{"message": {"content": content}}]}))

    items = service.llm_extract("x", reply("```json\n" + json.dumps(good) + "\n```"))
    assert items[0]["amount"] == 700 and items[1]["kind"] == "other" and items[1]["amount"] is None and items[1]["method"] is None
    assert service.llm_extract("x", reply("не json")) is None
    assert service.llm_extract("x", httpx.MockTransport(lambda req: httpx.Response(500))) is None


def test_work_for_retail_client_is_a_sale_of_work():
    items = service.rules_extract(
        "поменял дисп розничному клиенту его за 2000р без себеса и заменил акб на айфон 8 без гарантии за 3000 другому в рознице"
    )
    assert [(i["kind"], i["amount"], i["is_work"], i["no_cost"], i["guarantee_days"]) for i in items] == [
        ("sale", 2000, True, True, None),
        ("sale", 3000, True, False, 0),
    ]
    assert "дисп" in items[0]["title"] and "iphone 8" in items[1]["title"]
