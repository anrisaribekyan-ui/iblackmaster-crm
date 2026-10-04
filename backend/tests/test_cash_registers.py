from decimal import Decimal

from sqlalchemy import select

from app.models import CashRegister, Employee, Role
from app.security import hash_password


def test_balances_are_hidden_without_money_permission(client, db):
    role = Role(name="Без доступа к деньгам", permissions=["changeCashRegisterAccess"], scopes={})
    employee = Employee(
        name="Тест",
        short_name="Тест",
        email="cash-reader@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
    )
    db.add(employee)
    db.commit()
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.get("/api/cash-registers", headers=headers)

    assert response.status_code == 200
    assert response.json()
    assert all(item["cash_balance"] is None for item in response.json())
    assert all(item["bank_balance"] is None for item in response.json())


def test_cash_balance_input_is_ignored(client, auth_headers):
    response = client.post(
        "/api/cash-registers",
        json={"name": "Тестовая касса", "cash_balance": "999.99", "bank_balance": "888.88"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert Decimal(str(response.json()["cash_balance"])) == Decimal("0")
    assert Decimal(str(response.json()["bank_balance"])) == Decimal("0")


def test_cash_register_is_archived(client, auth_headers, db):
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id.is_not(None), CashRegister.is_active.is_(True))
    ).first()

    response = client.delete(f"/api/cash-registers/{register.id}", headers=auth_headers)

    assert response.status_code == 204
    assert db.get(CashRegister, register.id).is_active is False


def test_update_unknown_cash_register_returns_404(client, auth_headers):
    response = client.put(
        "/api/cash-registers/999999",
        json={"name": "Не найден"},
        headers=auth_headers,
    )
    assert response.status_code == 404