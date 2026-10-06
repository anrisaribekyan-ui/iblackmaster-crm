"""Тесты API главной (T-44)."""

from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import Counteragent, Employee, Location, Order, OrderStatus, OrderType, Role
from app.security import hash_password


def make_employee(db, *, name, email, permissions, location):
    role = Role(name=f"Роль {email}", permissions=permissions, scopes={})
    employee = Employee(
        name=name,
        short_name=name,
        email=email,
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add(employee)
    db.commit()
    return employee


def login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_order(db, *, deadline=None):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).order_by(OrderStatus.sort)).first()
    employee = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    counteragent = Counteragent(name="Клиент дашборда")
    db.add(counteragent)
    db.flush()
    order = Order(
        location_id=location.id,
        order_type_id=order_type.id,
        status_id=status.id,
        number=f"D-{counteragent.id}",
        counteragent_id=counteragent.id,
        created_by_id=employee.id,
        deadline=deadline,
    )
    db.add(order)
    db.commit()
    return order


def test_dashboard_orders_created(client, auth_headers, db):
    r = client.get("/api/dashboard", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert "orders" in body
    before = body["orders"]["created"]
    make_order(db)
    r = client.get("/api/dashboard", headers=auth_headers)
    assert r.json()["orders"]["created"] >= before + 1


def test_dashboard_overdue(client, auth_headers, db):
    order = make_order(db, deadline=utcnow() - timedelta(days=1))
    r = client.get("/api/dashboard", headers=auth_headers)
    overdue = r.json()["overdue"]
    assert overdue is not None
    assert any(item["number"] == order.number for item in overdue)


def test_dashboard_finance_null_without_right(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    make_employee(db, name="Без финансов", email="nofin@x.test", permissions=[], location=location)
    headers = login(client, "nofin@x.test")
    r = client.get("/api/dashboard", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["finance"] is None
    assert body["orders"]["closed"] is None
    assert body["overdue"] is None


def test_dashboard_money_move_is_not_expense(client, auth_headers, db):
    from decimal import Decimal

    from app.models import CashRegister
    from app.services import money

    registers = [r for r in db.scalars(select(CashRegister).where(CashRegister.is_active.is_(True)).order_by(CashRegister.id)) if r.accepts_cash]
    source, target = registers[0], registers[1]
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    money.create_transaction(db, cash_register_id=source.id, cash_item=money.get_system_item(db, "order", True), amount=Decimal("1000"), created_by_id=owner.id)
    db.commit()
    before = client.get("/api/dashboard", headers=auth_headers).json()["finance"]["expense"]
    r = client.post("/api/transactions/move", headers=auth_headers, json={
        "from_register_id": source.id, "to_register_id": target.id, "amount": "100"})
    assert r.status_code == 200, r.text
    after = client.get("/api/dashboard", headers=auth_headers).json()["finance"]["expense"]
    assert Decimal(str(after)) == Decimal(str(before))


def test_dashboard_trend_has_30_days_and_today(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus)).first()
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    customer = Counteragent(name="Тренд")
    db.add(customer)
    db.flush()
    db.add(Order(number="TREND-1", location_id=location.id, order_type_id=order_type.id, counteragent_id=customer.id,
                 status_id=status.id, created_by_id=owner.id))
    db.commit()
    body = client.get("/api/dashboard", headers=auth_headers).json()
    assert len(body["trend"]) == 30
    assert body["trend"][-1]["created"] == 1
    assert body["previous"]["created"] == 0
