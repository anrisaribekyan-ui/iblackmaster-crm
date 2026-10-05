from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import Counteragent, Employee, Location, Order, OrderHistory, OrderStatus, OrderType, Role, StatusGroup
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


def add_order(db, *, owner, location, order_type, counteragent, status, number, **values):
    order = Order(
        number=number,
        location_id=location.id,
        order_type_id=order_type.id,
        counteragent_id=counteragent.id,
        status_id=status.id,
        created_by_id=owner.id,
        **values,
    )
    db.add(order)
    db.commit()
    return order


def test_order_list_tabs_and_group_counts(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    customer = Counteragent(name="Счётчик")
    db.add(customer)
    db.flush()
    new_status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    work_status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.IN_WORK)).first()
    add_order(db, owner=owner, location=location, order_type=order_type, counteragent=customer, status=new_status, number="LIST-NEW")
    add_order(db, owner=owner, location=location, order_type=order_type, counteragent=customer, status=work_status, number="LIST-WORK")

    response = client.get("/api/orders", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert response.json()["counts"]["new"] == 1
    assert response.json()["counts"]["inWork"] == 1
    work = client.get("/api/orders?tab=inWork", headers=auth_headers).json()
    assert [item["number"] for item in work["items"]] == ["LIST-WORK"]


def test_order_list_phone_search_and_overdue(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Телефонный клиент", phones="79161866119")
    db.add(customer)
    db.flush()
    add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="LIST-PHONE",
        deadline=utcnow() - timedelta(days=1),
    )

    phone_result = client.get("/api/orders?q=8%20(916)%20186-61-19", headers=auth_headers).json()
    overdue_result = client.get("/api/orders?overdue=1", headers=auth_headers).json()

    assert [item["number"] for item in phone_result["items"]] == ["LIST-PHONE"]
    assert [item["number"] for item in overdue_result["items"]] == ["LIST-PHONE"]


def test_order_list_own_scope(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    locations = db.scalars(select(Location).order_by(Location.sort)).all()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Клиент own")
    role = Role(name="Только свои заказы", permissions=[], scopes={"orders": "own"})
    employee = Employee(
        name="Мастер",
        short_name="Мастер",
        email="own-orders@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add_all([customer, employee])
    db.flush()
    own_order = add_order(
        db,
        owner=employee,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="OWN-ORDER",
        master_id=employee.id,
    )
    add_order(
        db,
        owner=employee,
        location=locations[1],
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="OTHER-ORDER",
    )
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.get("/api/orders", headers=headers)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [own_order.id]


def test_order_update_records_only_changed_fields(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Информация")
    db.add(customer)
    db.flush()
    order = add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="INFO-CHANGE",
    )

    response = client.put(f"/api/orders/{order.id}", json={"note": "Обновлено", "brand": None}, headers=auth_headers)

    assert response.status_code == 200
    history = db.scalars(
        select(OrderHistory).where(OrderHistory.order_id == order.id, OrderHistory.type == "info_changed")
    ).one()
    assert history.data == {"note": [None, "Обновлено"]}


def test_changing_master_requires_specific_permission(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Мастер теста")
    role = Role(name="Только общие изменения", permissions=["changeOrderInfoAccess"], scopes={"orders": "all"})
    employee = Employee(
        name="Редактор",
        short_name="Редактор",
        email="order-editor@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    new_master = Employee(
        name="Другой мастер",
        short_name="Мастер 2",
        email="second-master@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add_all([customer, employee, new_master])
    db.flush()
    order = add_order(
        db,
        owner=employee,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="MASTER-CHANGE",
    )
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.put(f"/api/orders/{order.id}", json={"master_id": new_master.id}, headers=headers)

    assert response.status_code == 403


def test_order_delete_and_restore(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Удаление")
    db.add(customer)
    db.flush()
    order = add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="DELETE-RESTORE",
    )

    assert client.delete(f"/api/orders/{order.id}", headers=auth_headers).status_code == 200
    assert db.get(Order, order.id).is_deleted is True
    assert client.get(f"/api/orders/{order.id}", headers=auth_headers).status_code == 404
    assert client.post(f"/api/orders/{order.id}/restore", headers=auth_headers).status_code == 200
    assert db.get(Order, order.id).is_deleted is False