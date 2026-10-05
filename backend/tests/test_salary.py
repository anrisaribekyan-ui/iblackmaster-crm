"""Зарплата: правила как в LiveSklad (Евгений, Николай, Алексей, Гор) — проверка services/salary.py."""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import (
    AccrualKind,
    Counteragent,
    Employee,
    Location,
    Nomenclature,
    Order,
    OrderStatus,
    OrderType,
    SalaryEvent,
    SalaryRule,
    StatusGroup,
)
from app.services import orders as order_service
from app.services import salary, stock
from app.services import sales as sales_service


def status(db, group):
    found = db.scalars(select(OrderStatus).where(OrderStatus.group == group)).first()
    found.pay_required = False
    return found


@pytest.fixture()
def env(db):
    owner = db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    master = Employee(name="Мастер", short_name="Мастер", email="m@example.test", password_hash="x", role_id=owner.role_id)
    customer = Counteragent(name="Клиент")
    db.add_all([master, customer])
    db.flush()
    return {"owner": owner, "location": location, "order_type": order_type, "master": master, "customer": customer}


def rule(db, employee, kind, value, *, base="margin", accrue_on="finish", **extra):
    steps = extra.pop("steps", [{"from": 0, "value": value}])
    r = SalaryRule(employee_id=employee.id, kind=kind, base=base, value_type="percent", steps=steps,
                   accrue_on=accrue_on, discount_by=extra.pop("discount_by", "worker"), options=extra.pop("options", {}), **extra)
    db.add(r)
    db.flush()
    return r


def new_order(db, env, order_type=None):
    order = Order(number=f"S-{id(env)}-{db.scalar(select(Order.id).order_by(Order.id.desc())) or 0}",
                  location_id=env["location"].id, order_type_id=(order_type or env["order_type"]).id,
                  counteragent_id=env["customer"].id, status_id=status(db, StatusGroup.NEW).id,
                  created_by_id=env["owner"].id, master_id=env["master"].id)
    db.add(order)
    db.flush()
    db.refresh(order)
    return order


def events(db, employee):
    return db.scalars(select(SalaryEvent).where(SalaryEvent.employee_id == employee.id)).all()


def total(db, employee):
    return sum((e.amount for e in events(db, employee)), Decimal("0"))


def test_work_accrued_when_ready_and_removed_when_back(db, env):
    master = env["master"]
    rule(db, master, AccrualKind.WORK_ORDER, 50)
    order = new_order(db, env)
    order_service.add_position(db, order, env["owner"], name="Замена дисплея", is_work=True, price="3000", purchase_price="1000")
    assert total(db, master) == 0  # заказ ещё не готов

    order_service.change_status(db, order, status(db, StatusGroup.FINISH), env["owner"])
    assert total(db, master) == Decimal("1000")  # 50% от прибыли 2000

    order_service.change_status(db, order, status(db, StatusGroup.IN_WORK), env["owner"])
    assert total(db, master) == 0


def test_close_rule_waits_for_issue(db, env):
    master = env["master"]
    rule(db, master, AccrualKind.WORK_ORDER, 30, accrue_on="close")
    order = new_order(db, env)
    order_service.add_position(db, order, env["owner"], name="Чистка", is_work=True, price="1000")
    order_service.change_status(db, order, status(db, StatusGroup.FINISH), env["owner"])
    assert total(db, master) == 0
    order_service.change_status(db, order, status(db, StatusGroup.CLOSED), env["owner"])
    assert total(db, master) == Decimal("300")


def test_order_type_rule_overrides_general(db, env):
    master = env["master"]
    special = OrderType(name="Отвязка аккаунта при помощи ПК")
    db.add(special)
    db.flush()
    rule(db, master, AccrualKind.WORK_ORDER, 30)
    rule(db, master, AccrualKind.WORK_ORDER, 50, order_type_id=special.id)

    usual = new_order(db, env)
    order_service.add_position(db, usual, env["owner"], name="Работа", is_work=True, price="1000")
    order_service.change_status(db, usual, status(db, StatusGroup.FINISH), env["owner"])
    assert total(db, master) == Decimal("300")

    unlock = new_order(db, env, order_type=special)
    order_service.add_position(db, unlock, env["owner"], name="Отвязка", is_work=True, price="1000")
    order_service.change_status(db, unlock, status(db, StatusGroup.FINISH), env["owner"])
    assert total(db, master) == Decimal("800")


def test_worker_discount_reduces_base_company_does_not(db, env):
    master = env["master"]
    work_rule = rule(db, master, AccrualKind.WORK_ORDER, 50)
    order = new_order(db, env)
    order_service.add_position(db, order, env["owner"], name="Работа", is_work=True, price="2000")
    order.discount_sum = Decimal("1000")
    order_service.recalc_totals(order)
    order_service.change_status(db, order, status(db, StatusGroup.FINISH), env["owner"])
    assert total(db, master) == Decimal("500")  # скидка сотрудника: база 1000

    work_rule.discount_by = "company"
    salary.recalc_order(db, order)
    assert total(db, master) == Decimal("1000")  # скидка компании: база 2000


def test_negative_margin_gives_nothing(db, env):
    master = env["master"]
    rule(db, master, AccrualKind.WORK_ORDER, 50)
    order = new_order(db, env)
    order_service.add_position(db, order, env["owner"], name="В минус", is_work=True, price="500", purchase_price="800")
    order_service.change_status(db, order, status(db, StatusGroup.FINISH), env["owner"])
    assert total(db, master) == 0


def test_new_order_rule_goes_to_creator_on_close(db, env):
    owner = env["owner"]
    rule(db, owner, AccrualKind.NEW_ORDER, 30, accrue_on="close")
    order = new_order(db, env)
    order_service.add_position(db, order, owner, name="Работа", is_work=True, price="1000", purchase_price="0")
    order_service.change_status(db, order, status(db, StatusGroup.CLOSED), owner)
    assert total(db, owner) == Decimal("300")


def test_sale_threshold_location_and_return(db, env):
    seller = env["master"]
    location = env["location"]
    store = location.stores[0]
    # Как у Гора: 30% от прибыли, если прибыль чека >= 100 ₽; при возврате зарплату не сохраняем
    rule(db, seller, AccrualKind.SALE_SHOP, None, steps=[{"from": 100, "value": 30}], location_id=location.id)
    product = Nomenclature(code=990001, name="Чехол", is_work=False)
    db.add(product)
    db.flush()
    stock.receive(db, store.id, product.id, Decimal("10"), Decimal("200"))
    cash = location.cash_registers[0] if hasattr(location, "cash_registers") else None

    def sell(price, qty="1"):
        from app.models import CashRegister
        register = db.scalars(select(CashRegister).where(CashRegister.accepts_cash.is_(True))).first()
        return sales_service.create_sale(
            db, location_id=location.id, store_id=store.id, seller_id=seller.id, counteragent_id=None, discount_percent=Decimal("0"), discount_sum=Decimal("0"), note=None,
            positions=[{"nomenclature_id": product.id, "quantity": qty, "price": price}],
            payments=[{"cash_register_id": register.id, "amount": str(Decimal(price) * Decimal(qty))}],
        )

    sell("250")  # прибыль 50 — ниже порога
    assert total(db, seller) == 0
    sale = sell("500", "2")  # прибыль 600 → 180
    assert total(db, seller) == Decimal("180")

    from app.models import CashRegister
    register = db.scalars(select(CashRegister).where(CashRegister.accepts_cash.is_(True))).first()
    sales_service.refund_sale(db, sale=sale, employee_id=seller.id, cash_register_id=register.id, is_bank=False,
                              note=None, items=[{"sale_position_id": sale.positions[0].id, "quantity": "1"}])
    assert total(db, seller) == Decimal("90")  # остался 1 шт: прибыль 300


def test_manual_events_survive_recalc(db, env):
    master = env["master"]
    rule(db, master, AccrualKind.WORK_ORDER, 50)
    order = new_order(db, env)
    db.add(SalaryEvent(employee_id=master.id, kind=AccrualKind.BONUS, amount=Decimal("5000"), order_id=order.id, is_manual=True))
    db.flush()
    salary.recalc_order(db, order)
    assert total(db, master) == Decimal("5000")
