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

def test_quick_sale_free_position_and_top(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))
    ).first()
    product = Nomenclature(code=660050, name="Стекло без остатка", is_work=False, purchase_price=Decimal("90"))
    db.add(product)
    db.commit()

    for _ in range(2):
        r = client.post("/api/sales", headers=auth_headers, json={
            "location_id": location.id, "store_id": store.id,
            "positions": [{"name": "Кабель Type-C", "quantity": "1", "price": "500", "purchase_price": "120"}],
            "payments": [{"cash_register_id": register.id, "amount": "500"}],
        })
        assert r.status_code == 200, r.text
        assert Decimal(str(r.json()["total_purchase"])) == 120
    # Товар из справочника, которого нет на складе, — продаём без списания
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": location.id, "store_id": store.id,
        "positions": [{"nomenclature_id": product.id, "quantity": "1", "price": "700", "no_stock": True}],
        "payments": [{"cash_register_id": register.id, "amount": "700"}],
    })
    assert r.status_code == 200, r.text
    assert Decimal(str(r.json()["total_purchase"])) == 90
    # Ввели другую себестоимость — товар запоминает последнюю
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": location.id, "store_id": store.id,
        "positions": [{"nomenclature_id": product.id, "quantity": "1", "price": "700", "no_stock": True, "purchase_price": "150"}],
        "payments": [{"cash_register_id": register.id, "amount": "700"}],
    })
    assert r.status_code == 200, r.text
    assert Decimal(str(r.json()["total_purchase"])) == 150
    db.refresh(product)
    assert product.purchase_price == Decimal("150")
    # Без названия — нельзя
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": location.id, "store_id": store.id,
        "positions": [{"quantity": "1", "price": "100"}],
    })
    assert r.status_code in (400, 422)

    top = client.get(f"/api/sales/top?location_id={location.id}&store_id={store.id}", headers=auth_headers).json()
    assert top[0]["name"] == "Кабель Type-C" and top[0]["count"] == 2 and top[0]["nomenclature_id"] is None
    assert any(t["nomenclature_id"] == product.id and Decimal(str(t["stock"])) == 0 for t in top)


def test_sales_history_month_filter_and_paging(client, auth_headers, db):
    from datetime import datetime, timezone

    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    seller = db.scalars(select(__import__("app.models", fromlist=["Employee"]).Employee)).first()
    # 30 сентября 22:00 UTC = 1 октября 01:00 по Москве; 30 сентября 20:00 UTC = 30 сентября 23:00 МСК
    for i, moment in enumerate([datetime(2026, 9, 30, 20, 0), datetime(2026, 9, 30, 22, 0), datetime(2026, 8, 5, 10, 0)]):
        db.add(Sale(number=f"M{i}", date=moment.replace(tzinfo=timezone.utc), location_id=location.id, store_id=store.id,
                    seller_id=seller.id, total_price=Decimal("100"), paid=Decimal("100")))
    db.commit()

    sept = client.get(f"/api/sales?location_id={location.id}&month=2026-09", headers=auth_headers).json()
    assert [x["number"] for x in sept["items"]] == ["M0"] and sept["total"] == 1
    octo = client.get(f"/api/sales?location_id={location.id}&month=2026-10", headers=auth_headers).json()
    assert [x["number"] for x in octo["items"]] == ["M1"]
    assert client.get(f"/api/sales?location_id={location.id}", headers=auth_headers).json()["total"] == 3
    assert client.get(f"/api/sales?location_id={location.id}&month=bad", headers=auth_headers).status_code == 400


def test_sale_per_position_discount(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    response = client.post(
        "/api/sales",
        json={
            "location_id": location.id,
            "store_id": store.id,
            "positions": [
                {"name": "Стекло", "quantity": "1", "price": "1500", "discount": "300"},
                {"name": "Чехол", "quantity": "2", "price": "500", "purchase_price": "100"},
            ],
            "payments": [],
            "counteragent_id": None,
        },
        headers=auth_headers,
    )
    # без оплаты и покупателя чек не создать — проверяем сумму через полную оплату
    assert response.status_code == 400
    register = db.scalars(select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))).first()
    response = client.post(
        "/api/sales",
        json={
            "location_id": location.id,
            "store_id": store.id,
            "positions": [
                {"name": "Стекло", "quantity": "1", "price": "1500", "discount": "300"},
                {"name": "Чехол", "quantity": "2", "price": "500", "purchase_price": "100"},
            ],
            "payments": [{"cash_register_id": register.id, "amount": "2200"}],
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert Decimal(str(response.json()["total_price"])) == Decimal("2200")


def test_sale_detail_shows_payment_method(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))).first()
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": location.id, "store_id": store.id,
        "positions": [{"name": "Чай", "quantity": "1", "price": "500", "purchase_price": "100"}],
        "payments": [{"cash_register_id": register.id, "amount": "500"}],
    })
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/sales/{r.json()['id']}", headers=auth_headers).json()
    assert len(detail["payments"]) == 1
    assert detail["payments"][0]["method"] == "cash" and Decimal(str(detail["payments"][0]["amount"])) == 500
    assert detail["payments"][0]["register"] == register.name


def test_sale_change_payment_method(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))).first()
    register.accepts_cash = register.accepts_bank = True
    product = Nomenclature(code=660077, name="Товар для смены оплаты", is_work=False)
    db.add(product)
    db.flush()
    stock.receive(db, store.id, product.id, Decimal("3"), Decimal("40.00"))
    db.commit()
    cash0, bank0 = register.cash_balance, register.bank_balance
    created = client.post("/api/sales", headers=auth_headers, json={
        "location_id": location.id, "store_id": store.id,
        "positions": [{"nomenclature_id": product.id, "quantity": "1", "price": "500.00"}],
        "payments": [{"cash_register_id": register.id, "amount": "500.00", "is_bank": False}],
    })
    assert created.status_code == 200, created.text
    sale_id = created.json()["id"]
    pay = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()["payments"][0]
    r = client.post(f"/api/sales/{sale_id}/payments/{pay['id']}/change-method", json={"is_bank": True}, headers=auth_headers)
    assert r.status_code == 200, r.text
    db.expire_all()
    register = db.get(CashRegister, register.id)
    assert register.cash_balance == cash0 and register.bank_balance > bank0
    assert db.get(Sale, sale_id).paid == Decimal("500.00")
    shown = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()["payments"]
    assert len(shown) == 1 and shown[0]["method"] == "bank"
    again = client.post(f"/api/sales/{sale_id}/payments/{shown[0]['id']}/change-method", json={"is_bank": True}, headers=auth_headers)
    assert again.status_code == 422 or again.status_code == 400
