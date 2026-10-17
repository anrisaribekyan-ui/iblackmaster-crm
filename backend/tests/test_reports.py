"""Тесты API отчётов (T-46)."""

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db import utcnow
from app.models import (
    CashItem,
    CashRegister,
    Counteragent,
    Employee,
    Location,
    Nomenclature,
    Order,
    OrderPosition,
    OrderStatus,
    OrderType,
    Role,
    Sale,
    SalePosition,
    StockBalance,
    Store,
    Transaction,
)
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


def period():
    return (utcnow() - timedelta(days=1)).replace(tzinfo=None).isoformat(), (utcnow() + timedelta(days=1)).replace(tzinfo=None).isoformat()


def base_order(db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    status = db.scalars(select(OrderStatus).order_by(OrderStatus.sort)).first()
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    counteragent = Counteragent(name="Клиент отчёта")
    db.add(counteragent)
    db.flush()
    order = Order(
        location_id=location.id,
        order_type_id=order_type.id,
        status_id=status.id,
        number=f"R-{counteragent.id}",
        counteragent_id=counteragent.id,
        created_by_id=owner.id,
        master_id=owner.id,
        closed_at=utcnow(),
        total_price=Decimal("1000"),
        total_purchase=Decimal("400"),
    )
    db.add(order)
    db.flush()
    return order


def test_reports_orders(client, auth_headers, db):
    base_order(db)
    db.commit()
    date_from, date_to = period()
    r = client.get(f"/api/reports/orders?date_from={date_from}&date_to={date_to}&group_by=master", headers=auth_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert any(row["revenue"] == 1000 and row["cost"] == 400 and row["profit"] == 600 for row in data)


def test_reports_works(client, auth_headers, db):
    order = base_order(db)
    db.add(OrderPosition(order_id=order.id, is_work=True, name="Замена дисплея", quantity=Decimal("1"), sold_price=Decimal("1000"), purchase_price=Decimal("400")))
    db.commit()
    date_from, date_to = period()
    r = client.get(f"/api/reports/works?date_from={date_from}&date_to={date_to}&is_work=true&group_by=nomenclature", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert any(row["name"] == "Замена дисплея" and row["revenue"] == 1000 for row in r.json())


def test_reports_sales(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).order_by(Store.id)).first()
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    sale = Sale(number="S-1", date=utcnow(), location_id=location.id, store_id=store.id, seller_id=owner.id, total_price=Decimal("500"), total_purchase=Decimal("200"))
    db.add(sale)
    db.flush()
    db.add(SalePosition(sale_id=sale.id, name="Чехол", quantity=Decimal("1"), sold_price=Decimal("500"), purchase_price=Decimal("200")))
    db.commit()
    date_from, date_to = period()
    r = client.get(f"/api/reports/sales?date_from={date_from}&date_to={date_to}&group_by=seller", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert any(row["revenue"] == 500 for row in r.json())


def test_reports_cashflow(client, auth_headers, db):
    register = db.scalars(select(CashRegister).order_by(CashRegister.id)).first()
    cash_item = db.scalars(select(CashItem).order_by(CashItem.id)).first()
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    db.add(Transaction(date=utcnow(), cash_register_id=register.id, cash_item_id=cash_item.id, is_income=True, is_bank=False, amount=Decimal("300"), balance_after=Decimal("300"), location_id=location.id))
    db.commit()
    date_from, date_to = period()
    r = client.get(f"/api/reports/cashflow?date_from={date_from}&date_to={date_to}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert any(row["income"] == 300 for row in r.json())


def test_reports_stock_value(client, auth_headers, db):
    store = db.scalars(select(Store).order_by(Store.id)).first()
    nomenclature = Nomenclature(code=99999, name="Деталь")
    db.add(nomenclature)
    db.flush()
    db.add(StockBalance(store_id=store.id, nomenclature_id=nomenclature.id, quantity=Decimal("3"), avg_purchase_price=Decimal("100")))
    db.commit()
    r = client.get("/api/reports/stock-value", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert any(row["store_id"] == store.id and row["value"] == 300 for row in r.json())


def test_reports_forbidden_without_access(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    make_employee(db, name="Без отчётов", email="noreport@x.test", permissions=[], location=location)
    headers = login(client, "noreport@x.test")
    date_from, date_to = period()
    r = client.get(f"/api/reports/orders?date_from={date_from}&date_to={date_to}", headers=headers)
    assert r.status_code == 403


def test_reports_cost_null_without_margin(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    make_employee(db, name="Отчёты без маржи", email="nomargin@x.test", permissions=["reportAccess"], location=location)
    headers = login(client, "nomargin@x.test")
    base_order(db)
    db.commit()
    date_from, date_to = period()
    r = client.get(f"/api/reports/orders?date_from={date_from}&date_to={date_to}&group_by=master", headers=headers)
    assert r.status_code == 200
    assert any(row["cost"] is None and row["profit"] is None for row in r.json())


def _expense(db, name, amount, *, type_=None, location_id=None):
    register = db.scalars(select(CashRegister).order_by(CashRegister.id)).first()
    item = CashItem(name=name, is_income=False, type=type_)
    db.add(item)
    db.flush()
    db.add(Transaction(date=utcnow(), cash_register_id=register.id, cash_item_id=item.id, is_income=False, is_bank=False,
                       amount=Decimal(amount), balance_after=Decimal("0"), location_id=location_id))


def test_reports_profit_gross_and_net(client, auth_headers, db):
    from app.models import SalaryEvent

    order = base_order(db)  # выручка 1000, себестоимость 400
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    store = db.scalars(select(Store).order_by(Store.id)).first()
    db.add(Sale(number="S-P", date=utcnow(), location_id=order.location_id, store_id=store.id, seller_id=owner.id,
                total_price=Decimal("500"), total_purchase=Decimal("200")))
    db.add(SalaryEvent(employee_id=owner.id, kind="workOrder", date=utcnow(), amount=Decimal("150"), location_id=order.location_id))
    _expense(db, "Аренда тест", "100")  # общая, без точки
    _expense(db, "Комиссия тест", "20", type_="bankPercent", location_id=order.location_id)
    _expense(db, "Закупка тест", "999", type_="purchase", location_id=order.location_id)  # не расход
    _expense(db, "Выдача денежных средств из кассы учредителю", "5000", location_id=order.location_id)  # не расход
    db.commit()
    date_from, date_to = period()

    r = client.get(f"/api/reports/profit?date_from={date_from}&date_to={date_to}&group_by=month", headers=auth_headers)
    assert r.status_code == 200, r.text
    total = r.json()["total"]
    assert total["revenue"] == 1500 and total["cost"] == 600 and total["gross"] == 900
    assert total["salary"] == 150 and total["bank_fee"] == 20 and total["expenses"] == 100
    assert total["net"] == 900 - 150 - 20 - 100
    assert total["orders"] == 1 and total["sales"] == 1
    assert [i["name"] for i in r.json()["expense_items"]] == ["Аренда тест"]
    assert all(row["key"].endswith("-01") for row in r.json()["rows"])

    # По одной точке общая аренда не попадает
    r = client.get(f"/api/reports/profit?date_from={date_from}&date_to={date_to}&location_id={order.location_id}", headers=auth_headers)
    assert r.json()["total"]["expenses"] == 0


def test_reports_profit_needs_margin_access(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    make_employee(db, name="Без маржи", email="nomargin-profit@test.ru", permissions={"reportAccess": True}, location=location)
    date_from, date_to = period()
    r = client.get(f"/api/reports/profit?date_from={date_from}&date_to={date_to}", headers=login(client, "nomargin-profit@test.ru"))
    assert r.status_code == 403
