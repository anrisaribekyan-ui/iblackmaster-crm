from sqlalchemy import select

from app.models import Counteragent, Employee, Location, Order, OrderHistory, OrderType, Role
from app.security import hash_password


def order_payload(location_id, order_type_id, counteragent):
    return {
        "location_id": location_id,
        "order_type_id": order_type_id,
        "counteragent": counteragent,
        "brand": "Apple",
        "model": "iPhone 16",
        "serial": "SN-123",
        "approximate_price": "12000-16000",
        "problems": ["Не включается"],
        "custom_fields": {"custom_note": "Проверить"},
    }


def test_create_order_with_new_counteragent_and_read_card(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()

    response = client.post(
        "/api/orders",
        json=order_payload(location.id, order_type.id, {"name": "Новый клиент", "phones": "8 (916) 186-61-19"}),
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["number"] == "A15843"
    order_id = response.json()["id"]
    order = db.get(Order, order_id)
    assert order.counteragent.phones == "79161866119"
    history = db.scalars(select(OrderHistory).where(OrderHistory.order_id == order_id)).all()
    assert [event.type for event in history] == ["created"]

    detail = client.get(f"/api/orders/{order_id}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["counteragent"]["name"] == "Новый клиент"
    assert detail.json()["status"]["group"] == "new"
    assert detail.json()["history"][0]["type"] == "created"
    assert detail.json()["debt"] == "0.00"


def test_create_order_with_existing_counteragent(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    counteragent = Counteragent(name="Существующий клиент")
    db.add(counteragent)
    db.commit()

    response = client.post(
        "/api/orders",
        json=order_payload(location.id, order_type.id, {"id": counteragent.id}),
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert db.query(Counteragent).count() == 1


def test_required_form_field_is_enforced(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()

    response = client.post(
        "/api/orders",
        json=order_payload(location.id, order_type.id, {"phones": "79161866119"}),
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["message"] == "Заполните поле «Имя»"


def test_create_order_rejects_foreign_location(client, db):
    locations = db.scalars(select(Location).order_by(Location.sort)).all()
    role = Role(name="Создание заказов", permissions=["createOrderAccess"], scopes={"orders": "all"})
    employee = Employee(
        name="Оператор",
        short_name="Оператор",
        email="operator@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[locations[0]],
    )
    db.add(employee)
    db.commit()
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()

    response = client.post(
        "/api/orders",
        json=order_payload(locations[1].id, order_type.id, {"name": "Клиент"}),
        headers=headers,
    )

    assert response.status_code == 403