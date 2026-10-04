"""Тесты денег, склада и заказа. Эти тесты НЕЛЬЗЯ ослаблять или удалять — это защита от ошибок в деньгах."""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.errors import BusinessError
from app.models import (
    CashItemType,
    CashRegister,
    Counteragent,
    Location,
    Nomenclature,
    Order,
    OrderStatus,
    OrderType,
    StatusGroup,
    Store,
    Transaction,
)
from app.services import money, orders, stock


# --- helpers -------------------------------------------------------------------------

def panfilov(db) -> Location:
    return db.scalars(select(Location).where(Location.name.contains("Панфиловский"))).one()


def cash_reg(db) -> CashRegister:
    return db.scalars(select(CashRegister).where(CashRegister.name == "Касса Панфиловский")).one()


def terminal(db) -> CashRegister:
    return db.scalars(select(CashRegister).where(CashRegister.name == "Терминал")).one()


def store(db) -> Store:
    return panfilov(db).stores[0]


def status(db, name) -> OrderStatus:
    return db.scalars(select(OrderStatus).where(OrderStatus.name == name)).one()


def make_order(db, owner) -> Order:
    client = Counteragent(name="Тест Клиент", phones="79990000000")
    db.add(client)
    db.flush()
    order = Order(
        number=orders.next_order_number(db),
        location_id=panfilov(db).id,
        order_type_id=db.scalars(select(OrderType)).first().id,
        status_id=status(db, "Принят").id,
        counteragent_id=client.id,
        created_by_id=owner.id,
        master_id=owner.id,
    )
    db.add(order)
    db.flush()
    db.refresh(order)
    return order


def make_part(db, name="Дисплей iPhone 12", qty="3", price="2000") -> Nomenclature:
    nom = Nomenclature(code=db.query(Nomenclature).count() + 1, name=name, is_work=False)
    db.add(nom)
    db.flush()
    stock.receive(db, store(db).id, nom.id, qty, price)
    return nom


# --- деньги ----------------------------------------------------------------------------

def test_cash_payment_changes_register_and_client_balance(db, owner):
    order = make_order(db, owner)
    reg = cash_reg(db)
    before = reg.cash_balance
    orders.pay(db, order, owner, cash_register_id=reg.id, amount="1500", is_bank=False)
    assert reg.cash_balance == before + Decimal("1500")
    assert order.paid == Decimal("1500")
    assert db.get(Counteragent, order.counteragent_id).balance == Decimal("1500")


def test_bank_payment_to_terminal_creates_bank_fee(db, owner):
    order = make_order(db, owner)
    term = terminal(db)  # 9.7% комиссии
    orders.pay(db, order, owner, cash_register_id=term.id, amount="1000", is_bank=True)
    txs = db.scalars(select(Transaction).where(Transaction.order_id == order.id)).all()
    fee = [t for t in txs if t.cash_item.type == CashItemType.BANK_PERCENT]
    assert len(fee) == 1 and fee[0].amount == Decimal("97.00")
    assert term.bank_balance == Decimal("903.00")
    # Комиссия не меняет долг клиента
    assert db.get(Counteragent, order.counteragent_id).balance == Decimal("1000")


def test_cash_register_rejects_wrong_payment_kind(db, owner):
    order = make_order(db, owner)
    with pytest.raises(BusinessError):
        orders.pay(db, order, owner, cash_register_id=cash_reg(db).id, amount="100", is_bank=True)


def test_delete_payment_reverts_everything(db, owner):
    order = make_order(db, owner)
    term = terminal(db)
    tx = orders.pay(db, order, owner, cash_register_id=term.id, amount="1000", is_bank=True)
    orders.delete_payment(db, order, tx, owner)
    assert term.bank_balance == Decimal("0")
    assert order.paid == Decimal("0")
    assert db.get(Counteragent, order.counteragent_id).balance == Decimal("0")


def test_refund_more_than_paid_is_forbidden(db, owner):
    order = make_order(db, owner)
    orders.pay(db, order, owner, cash_register_id=cash_reg(db).id, amount="500", is_bank=False)
    with pytest.raises(BusinessError):
        orders.refund(db, order, owner, cash_register_id=cash_reg(db).id, amount="600", is_bank=False)


def test_move_money_between_registers_and_delete_both_legs(db, owner):
    reg = cash_reg(db)
    other = db.scalars(select(CashRegister).where(CashRegister.name == "Касса Лента")).one()
    reg.cash_balance = Decimal("1000")
    out_tx, in_tx = money.move_money(db, from_register_id=reg.id, to_register_id=other.id, amount="400")
    assert reg.cash_balance == Decimal("600") and other.cash_balance == Decimal("400")
    money.delete_transaction(db, in_tx)
    assert reg.cash_balance == Decimal("1000") and other.cash_balance == Decimal("0")
    assert out_tx.is_deleted and in_tx.is_deleted


def test_float_money_is_rejected():
    with pytest.raises(TypeError):
        money.to_money(10.5)


# --- склад -----------------------------------------------------------------------------

def test_moving_average_purchase_price(db):
    nom = make_part(db, qty="2", price="1000")
    stock.receive(db, store(db).id, nom.id, "2", "2000")
    bal = stock.get_balance(db, store(db).id, nom.id)
    assert bal.quantity == Decimal("4") and bal.avg_purchase_price == Decimal("1500.00")


def test_write_off_more_than_available_fails(db):
    nom = make_part(db, qty="1")
    with pytest.raises(BusinessError):
        stock.write_off(db, store(db).id, nom.id, "2")


# --- заказ -----------------------------------------------------------------------------

def test_order_numbers_continue_from_livesklad(db, owner):
    o1 = make_order(db, owner)
    o2 = make_order(db, owner)
    assert o1.number == "A15843" and o2.number == "A15844"


def test_part_in_order_writes_off_stock_and_returns_on_delete(db, owner):
    order = make_order(db, owner)
    nom = make_part(db, qty="3", price="2000")
    pos = orders.add_position(db, order, owner, nomenclature_id=nom.id, price="5000", store_id=store(db).id)
    assert stock.get_balance(db, store(db).id, nom.id).quantity == Decimal("2")
    assert pos.purchase_price == Decimal("2000.00")
    assert order.total_price == Decimal("5000.00")
    orders.remove_position(db, order, pos, owner)
    assert stock.get_balance(db, store(db).id, nom.id).quantity == Decimal("3")
    assert order.total_price == Decimal("0")


def test_order_discount(db, owner):
    order = make_order(db, owner)
    orders.add_position(db, order, owner, name="Замена дисплея", is_work=True, price="10000")
    order.discount_percent = Decimal("10")
    orders.recalc_totals(order)
    assert order.total_price == Decimal("9000.00")


def test_cannot_close_unpaid_order(db, owner):
    order = make_order(db, owner)
    orders.add_position(db, order, owner, name="Замена АКБ", is_work=True, price="3000")
    with pytest.raises(BusinessError):
        orders.change_status(db, order, status(db, "Закрыт (Выдан)"), owner)


def test_close_paid_order_sets_dates_and_balances_client(db, owner):
    order = make_order(db, owner)
    orders.add_position(db, order, owner, name="Замена АКБ", is_work=True, price="3000")
    orders.pay(db, order, owner, cash_register_id=cash_reg(db).id, amount="3000", is_bank=False)
    orders.change_status(db, order, status(db, "Закрыт (Выдан)"), owner)
    assert order.status.group == StatusGroup.CLOSED
    assert order.closed_at is not None and order.finished_at is not None
    assert order.closed_by_id == owner.id
    # оплатил 3000, начислено 3000 → долг 0
    assert db.get(Counteragent, order.counteragent_id).balance == Decimal("0")
    # выданный заказ нельзя менять
    with pytest.raises(BusinessError):
        orders.add_position(db, order, owner, name="Ещё работа", is_work=True, price="100")
    # вернули в работу — начисление снимается
    orders.change_status(db, order, status(db, "В работе"), owner)
    assert db.get(Counteragent, order.counteragent_id).balance == Decimal("3000")
    assert order.closed_at is None


def test_history_is_written(db, owner):
    order = make_order(db, owner)
    orders.add_position(db, order, owner, name="Диагностика", is_work=True, price="500")
    orders.change_status(db, order, status(db, "В работе"), owner, comment="взял")
    db.flush()
    from app.models import OrderHistory

    types = [h.type for h in db.scalars(select(OrderHistory).where(OrderHistory.order_id == order.id))]
    assert types == ["add_work", "status"]


# --- API -------------------------------------------------------------------------------

def test_login_and_me(client, auth_headers):
    r = client.get("/api/auth/me", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["is_owner"] is True and "createOrderAccess" in body["permissions"]


def test_wrong_password(client, owner):
    r = client.post("/api/auth/login", json={"email": owner.email, "password": "nope"})
    assert r.status_code == 401
    assert r.json()["message"] == "Неверный email или пароль"
