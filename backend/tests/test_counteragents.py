from decimal import Decimal

from sqlalchemy import select

from app.db import utcnow
from app.models import (
    CashItem,
    CashRegister,
    Counteragent,
    Employee,
    Location,
    Order,
    OrderStatus,
    OrderType,
    Sale,
    Store,
    Transaction,
)


def test_counteragent_search_normalizes_phone_and_by_phone(client, auth_headers, db):
    item = Counteragent(name="Иван", phones="79161866119")
    db.add(item)
    db.commit()

    response = client.get("/api/counteragents", params={"q": "8 (916) 186-61-19"}, headers=auth_headers)
    assert response.status_code == 200
    assert [entry["id"] for entry in response.json()["items"]] == [item.id]

    response = client.get("/api/counteragents/by-phone", params={"phone": "+7 916 1866119"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == item.id


def test_counteragent_input_cannot_set_balance(client, auth_headers, db):
    response = client.post(
        "/api/counteragents",
        json={"name": "Новый клиент", "phones": "8 (916) 186-61-19", "balance": "12345.67"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["phones"] == "79161866119"
    assert response.json()["balance"] == "0"
    assert db.get(Counteragent, response.json()["id"]).balance == 0


def test_counteragent_history(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).order_by(OrderStatus.sort)).first()
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    store = db.scalars(select(Store).order_by(Store.id)).first()
    register = db.scalars(select(CashRegister).order_by(CashRegister.id)).first()
    cash_item = db.scalars(select(CashItem).order_by(CashItem.id)).first()

    counteragent = Counteragent(name="Исторический клиент")
    db.add(counteragent)
    db.flush()

    order = Order(
        location_id=location.id, order_type_id=order_type.id, status_id=status.id,
        number="H-1", counteragent_id=counteragent.id, created_by_id=owner.id,
        brand="Apple", model="iPhone", total_price=Decimal("1000"), paid=Decimal("500"),
    )
    sale = Sale(number="H-S1", date=utcnow(), location_id=location.id, store_id=store.id, seller_id=owner.id, counteragent_id=counteragent.id, total_price=Decimal("700"))
    db.add_all([order, sale])
    db.flush()
    tx = Transaction(date=utcnow(), cash_register_id=register.id, cash_item_id=cash_item.id, is_income=True, is_bank=False, amount=Decimal("500"), balance_after=Decimal("500"), counteragent_id=counteragent.id)
    db.add(tx)
    db.commit()

    response = client.get(f"/api/counteragents/{counteragent.id}/history", headers=auth_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert any(row["number"] == "H-1" and row["device"] == "Apple iPhone" for row in data["orders"])
    assert any(row["number"] == "H-S1" for row in data["sales"])
    assert any(row["amount"] == 500 and row["is_income"] is True for row in data["transactions"])


def test_counteragent_history_requires_order_read(client, db):
    from app.models import Role
    from app.security import hash_password

    location = db.scalars(select(Location).order_by(Location.sort)).first()
    role = Role(name="Без заказов", permissions=[], scopes={})
    employee = Employee(name="Без", short_name="Без", email="noorders@x.test", password_hash=hash_password("password123", rounds=4), role=role, locations=[location])
    counteragent = Counteragent(name="Клиент")
    db.add_all([employee, counteragent])
    db.commit()
    r = client.post("/api/auth/login", json={"email": "noorders@x.test", "password": "password123"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    response = client.get(f"/api/counteragents/{counteragent.id}/history", headers=headers)
    assert response.status_code == 403