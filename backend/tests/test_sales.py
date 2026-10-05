from decimal import Decimal

from sqlalchemy import select

from app.models import CashRegister, Counteragent, Location, Nomenclature, Sale, SalePosition, StockBalance, Store, Transaction
from app.services import stock


def test_sale_payment_and_return_update_stock(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))
    ).first()
    buyer = Counteragent(name="Покупатель")
    product = Nomenclature(code=660001, name="Тестовый товар", is_work=False)
    db.add_all([buyer, product])
    db.flush()
    stock.receive(db, store.id, product.id, Decimal("5"), Decimal("40.00"))
    db.commit()

    response = client.post(
        "/api/sales",
        json={
            "location_id": location.id,
            "store_id": store.id,
            "counteragent_id": buyer.id,
            "positions": [{"nomenclature_id": product.id, "quantity": "2", "price": "150.00"}],
            "payments": [{"cash_register_id": register.id, "amount": "300.00", "is_bank": False}],
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    sale_id = response.json()["id"]
    assert response.json()["number"] == "Ч-1"
    assert Decimal(str(response.json()["total_price"])) == Decimal("300.00")
    balance = db.scalars(select(StockBalance).where(StockBalance.store_id == store.id)).one()
    assert balance.quantity == Decimal("3.000")
    position = db.scalars(select(SalePosition).where(SalePosition.sale_id == sale_id)).one()

    returned = client.post(
        f"/api/sales/{sale_id}/returns",
        json={
            "cash_register_id": register.id,
            "is_bank": False,
            "items": [{"sale_position_id": position.id, "quantity": "1"}],
        },
        headers=auth_headers,
    )
    assert returned.status_code == 200, returned.text
    assert Decimal(str(returned.json()["amount"])) == Decimal("150.00")
    assert db.scalars(select(StockBalance).where(StockBalance.store_id == store.id)).one().quantity == Decimal("4.000")
    assert db.scalars(select(Transaction).where(Transaction.sale_id == sale_id, Transaction.is_deleted.is_(False))).all()


def test_sale_cannot_return_more_than_sold(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))
    ).first()
    buyer = Counteragent(name="Покупатель для возврата")
    product = Nomenclature(code=660002, name="Ограниченный товар", is_work=False)
    db.add_all([buyer, product])
    db.flush()
    stock.receive(db, store.id, product.id, Decimal("3"), Decimal("20.00"))
    db.commit()
    response = client.post(
        "/api/sales",
        json={
            "location_id": location.id,
            "store_id": store.id,
            "counteragent_id": buyer.id,
            "positions": [{"nomenclature_id": product.id, "quantity": "1", "price": "50.00"}],
            "payments": [{"cash_register_id": register.id, "amount": "50.00"}],
        },
        headers=auth_headers,
    )
    sale = db.get(Sale, response.json()["id"])
    position = db.scalars(select(SalePosition).where(SalePosition.sale_id == sale.id)).one()

    returned = client.post(
        f"/api/sales/{sale.id}/returns",
        json={"cash_register_id": register.id, "items": [{"sale_position_id": position.id, "quantity": "2"}]},
        headers=auth_headers,
    )

    assert returned.status_code == 400
    assert returned.json()["message"] == "Нельзя вернуть больше проданного количества"


def test_partial_sale_payment_charges_customer_debt(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))
    ).first()
    buyer = Counteragent(name="Покупатель в долг")
    db.add(buyer)
    db.commit()

    response = client.post(
        "/api/sales",
        json={
            "location_id": location.id,
            "store_id": store.id,
            "counteragent_id": buyer.id,
            "positions": [{"name": "Диагностика", "is_work": True, "quantity": "1", "price": "100.00"}],
            "payments": [{"cash_register_id": register.id, "amount": "60.00"}],
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert Decimal(str(response.json()["paid"])) == Decimal("60.00")
    assert Decimal(str(response.json()["debt"])) == Decimal("40.00")