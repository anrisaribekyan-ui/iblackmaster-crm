from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db import utcnow
from app.models import (
    CashRegister,
    Counteragent,
    Employee,
    Location,
    Nomenclature,
    NomenclaturePrice,
    Order,
    OrderHistory,
    OrderPosition,
    OrderStatus,
    OrderType,
    PriceType,
    Role,
    StatusGroup,
    StockBalance,
    Store,
    Transaction,
)
from app.security import hash_password
from app.services import stock


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


def test_order_product_stock_writeoff_and_restore(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Запчасть")
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    product = Nomenclature(code=880001, name="Аккумулятор", is_work=False)
    minimum_type = db.scalars(select(PriceType).where(PriceType.is_minimal.is_(True))).one()
    db.add_all([customer, product])
    db.flush()
    db.add(
        NomenclaturePrice(
            nomenclature_id=product.id,
            price_type_id=minimum_type.id,
            price=Decimal("100.00"),
        )
    )
    order = add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="POSITION-STOCK",
    )
    stock.receive(db, store.id, product.id, Decimal("5"), Decimal("40"))
    db.commit()

    response = client.post(
        f"/api/orders/{order.id}/positions",
        json={"nomenclature_id": product.id, "quantity": "2", "price": "150.00", "store_id": store.id},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    position_id = response.json()["id"]
    balance = db.scalars(select(StockBalance).where(StockBalance.store_id == store.id)).one()
    assert balance.quantity == Decimal("3.000")

    update = client.put(
        f"/api/orders/{order.id}/positions/{position_id}",
        json={"sold_price": "160.00"},
        headers=auth_headers,
    )
    assert update.status_code == 200
    assert Decimal(str(update.json()["sold_price"])) == Decimal("160.00")

    response = client.delete(f"/api/orders/{order.id}/positions/{position_id}", headers=auth_headers)
    assert response.status_code == 204
    assert db.scalars(select(StockBalance).where(StockBalance.store_id == store.id)).one().quantity == Decimal("5.000")


def test_minimum_price_requires_permission(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Минимальная цена")
    role = Role(name="Без минимальной цены", permissions=["changeOrderPositionAccess"], scopes={"orders": "all"})
    employee = Employee(
        name="Редактор цены",
        short_name="Цена",
        email="price-editor@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    product = Nomenclature(code=880002, name="Кабель", is_work=True)
    minimum_type = db.scalars(select(PriceType).where(PriceType.is_minimal.is_(True))).one()
    db.add_all([customer, employee, product])
    db.flush()
    db.add(
        NomenclaturePrice(
            nomenclature_id=product.id,
            price_type_id=minimum_type.id,
            price=Decimal("100.00"),
        )
    )
    order = add_order(
        db,
        owner=employee,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="MIN-PRICE",
    )
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.post(
        f"/api/orders/{order.id}/positions",
        json={"nomenclature_id": product.id, "price": "99.00"},
        headers=headers,
    )

    assert response.status_code == 403


def test_order_discount_recalculates_total(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Скидка")
    db.add(customer)
    db.flush()
    order = add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number="DISCOUNT",
    )
    db.add(
        OrderPosition(
            order_id=order.id,
            is_work=True,
            name="Ремонт",
            quantity=Decimal("1"),
            price=Decimal("1000.00"),
            sold_price=Decimal("1000.00"),
        )
    )
    db.commit()

    response = client.put(f"/api/orders/{order.id}/discount", json={"discount_percent": "10"}, headers=auth_headers)

    assert response.status_code == 200
    assert Decimal(str(response.json()["total_price"])) == Decimal("900.00")


def test_order_status_required_comment_and_history(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    current_status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="История")
    next_status = OrderStatus(
        group=StatusGroup.WAIT,
        name="Ждём клиента",
        color="#112233",
        sort=999,
        comment_mode="required",
    )
    db.add_all([customer, next_status])
    db.flush()
    order = add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=current_status,
        number="STATUS-HISTORY",
    )

    rejected = client.post(
        f"/api/orders/{order.id}/status",
        json={"status_id": next_status.id},
        headers=auth_headers,
    )
    assert rejected.status_code == 400

    changed = client.post(
        f"/api/orders/{order.id}/status",
        json={"status_id": next_status.id, "comment": "Свяжитесь с клиентом"},
        headers=auth_headers,
    )
    assert changed.status_code == 200
    client.post(f"/api/orders/{order.id}/comments", json={"text": "Позвонили"}, headers=auth_headers)
    history = client.get(f"/api/orders/{order.id}/history", headers=auth_headers)

    assert history.status_code == 200
    assert history.json()[0]["type"] == "comment"
    assert history.json()[0]["employee_name"] == owner.short_name
    status_event = next(item for item in history.json() if item["type"] == "status")
    assert status_event["status"]["color"] == "#112233"


def test_cannot_close_unpaid_order(client, auth_headers, db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    current_status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    closed_status = db.scalars(
        select(OrderStatus).where(OrderStatus.group == StatusGroup.CLOSED, OrderStatus.pay_required.is_(True))
    ).first()
    customer = Counteragent(name="Неоплаченный")
    db.add(customer)
    db.flush()
    order = add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=current_status,
        number="UNPAID-CLOSE",
        total_price=Decimal("100.00"),
    )

    response = client.post(
        f"/api/orders/{order.id}/status",
        json={"status_id": closed_status.id},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert "Заказ не оплачен" in response.json()["message"]


def create_payment_test_order(db, owner, number, total_price=Decimal("1000.00")):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name=number)
    db.add(customer)
    db.flush()
    return add_order(
        db,
        owner=owner,
        location=location,
        order_type=order_type,
        counteragent=customer,
        status=status,
        number=number,
        total_price=total_price,
    )


def test_order_payment_and_refund_change_debt(client, auth_headers, db, owner):
    order = create_payment_test_order(db, owner, "PAY-REFUND")
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == order.location_id, CashRegister.is_active.is_(True))
    ).first()

    payment = client.post(
        f"/api/orders/{order.id}/payments",
        json={"cash_register_id": register.id, "amount": "300.00", "is_bank": False},
        headers=auth_headers,
    )
    assert payment.status_code == 200, payment.text
    assert Decimal(str(payment.json()["debt"])) == Decimal("700.00")

    refund = client.post(
        f"/api/orders/{order.id}/refunds",
        json={"cash_register_id": register.id, "amount": "100.00", "is_bank": False},
        headers=auth_headers,
    )
    assert refund.status_code == 200, refund.text
    assert Decimal(str(refund.json()["debt"])) == Decimal("800.00")


def test_order_payment_can_be_deleted(client, auth_headers, db, owner):
    order = create_payment_test_order(db, owner, "PAY-DELETE")
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == order.location_id, CashRegister.is_active.is_(True))
    ).first()
    payment = client.post(
        f"/api/orders/{order.id}/payments",
        json={"cash_register_id": register.id, "amount": "250.00"},
        headers=auth_headers,
    )
    assert payment.status_code == 200

    response = client.delete(
        f"/api/orders/{order.id}/payments/{payment.json()['id']}",
        headers=auth_headers,
    )

    assert response.status_code == 204
    assert db.get(Order, order.id).paid == Decimal("0.00")
    assert db.get(Transaction, payment.json()["id"]).is_deleted is True


def test_order_payment_rejects_cash_register_from_foreign_location(client, db):
    locations = db.scalars(select(Location).order_by(Location.sort)).all()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.NEW)).first()
    customer = Counteragent(name="Чужая касса")
    role = Role(name="Оплата своей локации", permissions=["operationCashRegisterAccess"], scopes={"orders": "all"})
    employee = Employee(
        name="Кассир",
        short_name="Кассир",
        email="order-cashier@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[locations[0]],
    )
    db.add_all([customer, employee])
    db.flush()
    order = Order(
        number="FOREIGN-REGISTER",
        location_id=locations[0].id,
        order_type_id=order_type.id,
        status_id=status.id,
        counteragent=customer,
        created_by_id=employee.id,
        total_price=Decimal("100.00"),
    )
    register = db.scalars(
        select(CashRegister).where(CashRegister.location_id == locations[1].id, CashRegister.is_active.is_(True))
    ).first()
    db.add(order)
    db.commit()
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.post(
        f"/api/orders/{order.id}/payments",
        json={"cash_register_id": register.id, "amount": "10.00"},
        headers=headers,
    )

    assert response.status_code == 403