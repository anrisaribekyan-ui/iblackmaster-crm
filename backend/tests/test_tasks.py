"""Тесты API задач (T-41)."""

from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import Counteragent, Employee, Location, Order, OrderStatus, OrderType, Role, Task
from app.security import hash_password


def make_employee(db, *, name, email, permissions, scopes=None, location=None, is_owner=False):
    role = Role(name=f"Роль {email}", permissions=permissions, scopes=scopes or {})
    if location is None:
        location = db.scalars(select(Location).order_by(Location.sort)).first()
    employee = Employee(
        name=name,
        short_name=name,
        email=email,
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
        is_owner=is_owner,
    )
    db.add(employee)
    db.commit()
    return employee


def login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_order(db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).order_by(OrderStatus.sort)).first()
    employee = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    counteragent = Counteragent(name="Клиент задач")
    db.add(counteragent)
    db.flush()
    order = Order(
        location_id=location.id,
        order_type_id=order_type.id,
        status_id=status.id,
        number="T-1",
        counteragent_id=counteragent.id,
        created_by_id=employee.id,
    )
    db.add(order)
    db.commit()
    return order


def test_create_and_list_tasks(client, auth_headers, db):
    r = client.post("/api/tasks", json={"title": "Починить телефон", "text": "Экран"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    task_id = r.json()["id"]
    assert r.json()["author_name"] is not None

    listing = client.get("/api/tasks?status=open", headers=auth_headers)
    assert listing.status_code == 200
    assert listing.json()["total"] >= 1
    assert any(item["id"] == task_id for item in listing.json()["items"])


def test_own_vs_all_scope(client, db, auth_headers):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    worker = make_employee(
        db, name="Работник", email="worker@x.test",
        permissions=["createTaskAccess"], scopes={"tasks": "own"}, location=location,
    )
    other = make_employee(
        db, name="Другой", email="other@x.test",
        permissions=["createTaskAccess"], scopes={"tasks": "own"}, location=location,
    )

    worker_headers = login(client, "worker@x.test")
    other_headers = login(client, "other@x.test")

    created = client.post("/api/tasks", json={"title": "Моя задача"}, headers=worker_headers)
    assert created.status_code == 200

    # другой (own) не видит чужую задачу
    listing = client.get("/api/tasks?status=all", headers=other_headers)
    assert listing.json()["total"] == 0

    # владелец видит все
    listing = client.get("/api/tasks?status=all", headers=auth_headers)
    assert listing.json()["total"] >= 1


def test_overdue_and_done_reopen(client, auth_headers, db):
    past = (utcnow() - timedelta(days=1)).isoformat()
    r = client.post("/api/tasks", json={"title": "Просрочка", "deadline": past}, headers=auth_headers)
    task_id = r.json()["id"]

    overdue = client.get("/api/tasks?status=overdue", headers=auth_headers)
    assert any(item["id"] == task_id for item in overdue.json()["items"])

    done = client.post(f"/api/tasks/{task_id}/done", headers=auth_headers)
    assert done.status_code == 200
    assert done.json()["is_done"] is True
    assert done.json()["done_at"] is not None

    reopened = client.post(f"/api/tasks/{task_id}/reopen", headers=auth_headers)
    assert reopened.json()["is_done"] is False


def test_forbidden_without_create_access(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    make_employee(db, name="Безправный", email="noperm@x.test", permissions=[], location=location)
    headers = login(client, "noperm@x.test")
    r = client.post("/api/tasks", json={"title": "Нельзя"}, headers=headers)
    assert r.status_code == 403
    r = client.get("/api/tasks", headers=headers)
    assert r.status_code == 403


def test_cannot_edit_foreign_without_change_all(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    worker = make_employee(
        db, name="Автор", email="author@x.test",
        permissions=["createTaskAccess"], scopes={"tasks": "own"}, location=location,
    )
    other = make_employee(
        db, name="Чужой", email="intruder@x.test",
        permissions=["createTaskAccess"], scopes={"tasks": "all"}, location=location,
    )
    worker_headers = login(client, "author@x.test")
    other_headers = login(client, "intruder@x.test")

    created = client.post("/api/tasks", json={"title": "Чужая задача"}, headers=worker_headers)
    task_id = created.json()["id"]

    r = client.put(f"/api/tasks/{task_id}", json={"title": "Перехват"}, headers=other_headers)
    assert r.status_code == 403


def test_task_bound_to_order_writes_history(client, auth_headers, db):
    from app.models import Counteragent, OrderHistory

    order = make_order(db)
    r = client.post(
        "/api/tasks",
        json={"title": "Позвонить клиенту", "order_id": order.id},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["order_id"] == order.id
    assert r.json()["location_id"] == order.location_id

    history = db.scalars(select(OrderHistory).where(OrderHistory.order_id == order.id)).all()
    assert any(h.text == "Задача: Позвонить клиенту" for h in history)
