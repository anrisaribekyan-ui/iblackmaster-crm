"""Списки и просмотр складских документов и чеков (для экранов склада и продаж)."""

from decimal import Decimal

from sqlalchemy import select

from app.models import Location, Nomenclature
from app.services import stock


def _setup(client, db, auth_headers):
    loc = db.scalars(select(Location).where(Location.name.contains("Панфиловский"))).one()
    store = loc.stores[0]
    nom = Nomenclature(code=777, name="Шлейф", is_work=False)
    db.add(nom)
    db.commit()
    return loc, store, nom


def test_purchase_list_and_detail(client, db, auth_headers):
    loc, store, nom = _setup(client, db, auth_headers)
    r = client.post("/api/stock-documents", headers=auth_headers, json={
        "type": "purchase", "location_id": loc.id, "store_id": store.id,
        "positions": [{"nomenclature_id": nom.id, "quantity": "3", "price": "150"}],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    lst = client.get("/api/stock-documents?type=purchase", headers=auth_headers).json()
    assert lst["total"] == 1 and lst["items"][0]["store"] == store.name
    detail = client.get(f"/api/stock-documents/{doc_id}", headers=auth_headers).json()
    assert detail["positions"][0]["name"] == "Шлейф"
    assert Decimal(str(detail["total"])) == Decimal("450")


def test_sales_list_and_detail(client, db, auth_headers):
    loc, store, nom = _setup(client, db, auth_headers)
    stock.receive(db, store.id, nom.id, "5", "100")
    db.commit()
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": loc.id, "store_id": store.id,
        "positions": [{"nomenclature_id": nom.id, "quantity": "2", "price": "300"}],
    })
    # без оплаты и без покупателя — нельзя (продажа в долг только с покупателем)
    assert r.status_code == 400
    cash = [x for x in client.get("/api/cash-registers", headers=auth_headers).json() if x["name"] == "Касса Панфиловский"][0]
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": loc.id, "store_id": store.id,
        "positions": [{"nomenclature_id": nom.id, "quantity": "2", "price": "300"}],
        "payments": [{"cash_register_id": cash["id"], "amount": "600"}],
    })
    assert r.status_code == 200, r.text
    lst = client.get(f"/api/sales?location_id={loc.id}", headers=auth_headers).json()
    assert lst["total"] == 1
    detail = client.get(f"/api/sales/{r.json()['id']}", headers=auth_headers).json()
    assert detail["positions"][0]["name"] == "Шлейф"
