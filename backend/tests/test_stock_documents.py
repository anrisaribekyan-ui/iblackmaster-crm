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