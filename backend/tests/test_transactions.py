from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db import utcnow
from app.models import CashItem, CashRegister, Counteragent, Employee, Location, Order, OrderStatus, OrderType, Role, StatusGroup
from app.security import hash_password


def test_manual_expense_changes_register_balance(client, auth_headers, db):
    register = db.scalars(select(CashRegister).where(CashRegister.is_active.is_(True))).first()
    item = CashItem(name="Ручной расход", is_income=False, type=None, affects_balance=False)
    db.add(item)
    db.commit()
    original_balance = register.cash_balance

    response = client.post(
        "/api/transactions",
        json={"cash_register_id": register.id, "cash_item_id": item.id, "amount": "75.00", "is_bank": False},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert db.get(CashRegister, register.id).cash_balance == original_balance - Decimal("75.00")


def test_order_payment_cannot_be_deleted_from_journal(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    counteragent = Counteragent(name="Связанная оплата")
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))
    ).first()
    order = Order(
        number="TX-ORDER",
        location_id=location.id,
        order_type_id=order_type.id,
        status_id=status.id,
        counteragent=counteragent,
        created_by_id=owner.id,
    )
    db.add(order)
    db.flush()
    login = client.post("/api/auth/login", json={"email": owner.email, "password": "demo1234"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    payment = client.post(
        f"/api/orders/{order.id}/payments",
        json={"cash_register_id": register.id, "amount": "25.00"},
        headers=headers,
    )
    assert payment.status_code == 200

    response = client.delete(f"/api/transactions/{payment.json()['id']}", headers=headers)

    assert response.status_code == 400
    assert "только из карточки" in response.json()["message"]


def test_past_manual_transaction_requires_cash_date_permission(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))
    ).first()
    item = CashItem(name="Расход без даты", is_income=False, type=None, affects_balance=False)
    role = Role(name="Только операции", permissions=["operationCashRegisterAccess"], scopes={})
    employee = Employee(
        name="Кассир",
        short_name="Кассир",
        email="no-cash-date@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add_all([item, employee])
    db.commit()
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.post(
        "/api/transactions",
        json={
            "cash_register_id": register.id,
            "cash_item_id": item.id,
            "amount": "10.00",
            "date": (utcnow() - timedelta(days=1)).isoformat(),
        },
        headers=headers,
    )

    assert response.status_code == 403

def test_cash_items_crud_and_transaction_journal(client, auth_headers, db):
    assert client.get("/api/cash-items", headers=auth_headers).status_code == 200

    created = client.post(
        "/api/cash-items",
        json={"name": "Ночная статья", "is_income": False, "affects_balance": True},
        headers=auth_headers,
    )
    assert created.status_code == 200, created.text
    item_id = created.json()["id"]
    assert item_id in [item["id"] for item in client.get("/api/cash-items", headers=auth_headers).json()]

    updated = client.put(
        f"/api/cash-items/{item_id}",
        json={"name": "Ночная статья 2", "is_income": True, "affects_balance": True},
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Ночная статья 2"

    register = db.scalars(select(CashRegister).where(CashRegister.is_active.is_(True))).first()
    transaction = client.post(
        "/api/transactions",
        json={"cash_register_id": register.id, "cash_item_id": item_id, "amount": "10"},
        headers=auth_headers,
    )
    assert transaction.status_code == 200, transaction.text
    journal = client.get("/api/transactions", headers=auth_headers)
    assert journal.status_code == 200
    assert transaction.json()["id"] in [row["id"] for row in journal.json()["items"]]

    assert client.delete(f"/api/transactions/{transaction.json()['id']}", headers=auth_headers).status_code == 204
    assert transaction.json()["id"] not in [row["id"] for row in client.get("/api/transactions", headers=auth_headers).json()["items"]]
    restored = client.post(f"/api/transactions/{transaction.json()['id']}/restore", headers=auth_headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_deleted"] is False

    assert client.delete(f"/api/cash-items/{item_id}", headers=auth_headers).status_code == 204
    assert item_id not in [item["id"] for item in client.get("/api/cash-items", headers=auth_headers).json()]
