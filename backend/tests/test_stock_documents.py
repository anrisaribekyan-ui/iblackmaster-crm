from decimal import Decimal

from sqlalchemy import select

from app.models import (
    CashRegister,
    Counteragent,
    Location,
    Nomenclature,
    StockBalance,
    StockDocument,
    Store,
    Transaction,
)
from app.services import stock


def stock_quantity(db, store_id, nomenclature_id):
    balance = db.scalars(
        select(StockBalance).where(
            StockBalance.store_id == store_id,
            StockBalance.nomenclature_id == nomenclature_id,
        )
    ).first()
    return balance.quantity if balance else Decimal("0")


def test_purchase_move_cancellation_and_reverse(client, auth_headers, db):
    locations = db.scalars(select(Location).order_by(Location.sort)).all()
    stores = db.scalars(select(Store).order_by(Store.id)).all()
    source = next(store for store in stores if store.location_id == locations[0].id)
    destination = next(store for store in stores if store.location_id == locations[1].id)
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == locations[0].id, CashRegister.is_active.is_(True))
    ).first()
    vendor = Counteragent(name="Поставщик теста", is_vendor=True)
    product = Nomenclature(code=770001, name="Тестовая запчасть", is_work=False)
    db.add_all([vendor, product])
    db.commit()

    purchase = client.post(
        "/api/stock-documents",
        json={
            "type": "purchase",
            "location_id": locations[0].id,
            "store_id": source.id,
            "counteragent_id": vendor.id,
            "cash_register_id": register.id,
            "amount": "200.00",
            "positions": [{"nomenclature_id": product.id, "quantity": "2", "price": "100.00"}],
        },
        headers=auth_headers,
    )
    assert purchase.status_code == 200, purchase.text
    purchase_id = purchase.json()["id"]
    assert purchase.json()["number"] == "П-1"
    assert purchase.json()["total"] == "200.00"
    assert purchase.json()["paid"] == "200.00"
    assert stock_quantity(db, source.id, product.id) == Decimal("2.000")
    assert db.scalars(select(Transaction).where(Transaction.stock_document_id == purchase_id)).first() is not None

    move = client.post(
        "/api/stock-documents",
        json={
            "type": "move",
            "location_id": locations[0].id,
            "store_id": source.id,
            "to_store_id": destination.id,
            "positions": [{"nomenclature_id": product.id, "quantity": "1"}],
        },
        headers=auth_headers,
    )
    assert move.status_code == 200, move.text
    move_id = move.json()["id"]
    assert move.json()["number"] == "ПМ-1"
    assert stock_quantity(db, source.id, product.id) == Decimal("1.000")
    assert stock_quantity(db, destination.id, product.id) == Decimal("1.000")

    cancellation = client.post(
        "/api/stock-documents",
        json={
            "type": "cancellation",
            "location_id": locations[0].id,
            "store_id": source.id,
            "positions": [{"nomenclature_id": product.id, "quantity": "1"}],
        },
        headers=auth_headers,
    )
    assert cancellation.status_code == 200, cancellation.text
    cancellation_id = cancellation.json()["id"]
    assert cancellation.json()["number"] == "С-1"
    assert stock_quantity(db, source.id, product.id) == Decimal("0.000")

    blocked = client.delete(f"/api/stock-documents/{purchase_id}", headers=auth_headers)
    assert blocked.status_code == 400
    assert "недостаточно на складе" in blocked.json()["message"]

    assert client.delete(f"/api/stock-documents/{cancellation_id}", headers=auth_headers).status_code == 204
    assert stock_quantity(db, source.id, product.id) == Decimal("1.000")
    assert client.delete(f"/api/stock-documents/{move_id}", headers=auth_headers).status_code == 204
    assert stock_quantity(db, source.id, product.id) == Decimal("2.000")
    assert stock_quantity(db, destination.id, product.id) == Decimal("0.000")
    assert client.delete(f"/api/stock-documents/{purchase_id}", headers=auth_headers).status_code == 204
    assert stock_quantity(db, source.id, product.id) == Decimal("0.000")
    assert db.get(StockDocument, purchase_id).is_deleted is True


def test_inventory_create_update_and_finish(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    accounted_item = Nomenclature(code=770201, name="Учтённый товар", is_work=False)
    shortage_item = Nomenclature(code=770202, name="Товар с недостачей", is_work=False)
    new_item = Nomenclature(code=770203, name="Неучтённый товар", is_work=False)
    db.add_all([accounted_item, shortage_item, new_item])
    db.flush()
    stock.receive(db, store.id, accounted_item.id, Decimal("5"), Decimal("100.00"))
    stock.receive(db, store.id, shortage_item.id, Decimal("3"), Decimal("40.00"))
    db.commit()

    created = client.post(
        "/api/stock-documents/inventory",
        json={"location_id": location.id, "store_id": store.id, "note": "Проверка остатков"},
        headers=auth_headers,
    )
    assert created.status_code == 200, created.text
    document = created.json()
    assert document["type"] == "inventory"
    assert document["is_posted"] is False
    assert {position["nomenclature_id"] for position in document["positions"]} == {
        accounted_item.id,
        shortage_item.id,
    }
    assert all(position["quantity"] == position["quantity_accounted"] for position in document["positions"])

    updated = client.put(
        f"/api/stock-documents/{document['id']}/positions",
        json={
            "positions": [
                {"nomenclature_id": accounted_item.id, "quantity": "7"},
                {"nomenclature_id": shortage_item.id, "quantity": "1"},
                {"nomenclature_id": new_item.id, "quantity": "2"},
            ]
        },
        headers=auth_headers,
    )
    assert updated.status_code == 200, updated.text
    added = next(position for position in updated.json()["positions"] if position["nomenclature_id"] == new_item.id)
    assert added["quantity_accounted"] == "0.000"

    finished = client.post(f"/api/stock-documents/{document['id']}/finish", headers=auth_headers)
    assert finished.status_code == 200, finished.text
    assert finished.json()["is_posted"] is True
    assert stock_quantity(db, store.id, accounted_item.id) == Decimal("7.000")
    assert stock_quantity(db, store.id, shortage_item.id) == Decimal("1.000")
    assert stock_quantity(db, store.id, new_item.id) == Decimal("2.000")

    repeated = client.post(f"/api/stock-documents/{document['id']}/finish", headers=auth_headers)
    assert repeated.status_code == 400
    assert repeated.json()["message"] == "Инвентаризация уже проведена"

    edit_posted = client.put(
        f"/api/stock-documents/{document['id']}/positions",
        json={"positions": [{"nomenclature_id": accounted_item.id, "quantity": "8"}]},
        headers=auth_headers,
    )
    assert edit_posted.status_code == 400
    assert edit_posted.json()["message"] == "Нельзя менять проведённую инвентаризацию"