"""Перенос кассовой истории из LiveSklad."""

from decimal import Decimal

from openpyxl import Workbook
from sqlalchemy import select

from app.importers.livesklad_cash import run
from app.models import CashItem, CashRegister, Counteragent, Employee, Location, Order, OrderStatus, OrderType, Transaction

HEADER = ["Локация", "Номер", "Дата", "Форма оплаты", "Номер ОФД", "Касса", "Статья", "Ответственный", "Примечание", "Сумма", "Остаток", "Получатель"]


def _file(tmp_path, location):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER)
    # В выгрузке новые операции идут первыми
    ws.append([location, "A100", "30.10.2026 16:42", "Наличными", None, "Касса Панфиловский", "Оплата за заказ", "Sar. Anri", None, 500, 1500, "Татьяна"])
    ws.append([location, None, "29.10.2026 21:14", "Наличными", None, "Касса Панфиловский", "Инкассация", "Sar. Anri", "расхождения", -21000, 1000, "Sar. Anri"])
    ws.append([location, "B003394", "29.10.2026 17:55", "По карте", "ОФД1", "Терминал", "Оплата чека", "Sar. Anri", None, 1500, 22001.5, None])
    ws.append([location, None, "29.10.2026 17:55", "Безналом", None, "Терминал", "Комиссия банка (эквайринг)", "Sar. Anri", None, -145.5, 20500, None])
    ws.append([location, None, "01.09.2026 10:00", "Наличными", None, "Касса Панфиловский", "Оплата за аренду", "Sar. Anri", None, 22000, 22000, None])
    path = tmp_path / "Транзакции.xlsx"
    wb.save(path)
    return str(path)


def test_import_cash_history(db, tmp_path, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    client = Counteragent(name="Татьяна")
    db.add(client)
    db.flush()
    order = Order(
        number="A100", location_id=location.id, order_type_id=db.scalars(select(OrderType)).first().id,
        counteragent_id=client.id, status_id=db.scalars(select(OrderStatus)).first().id, created_by_id=owner.id,
        total_price=500, paid=500,
    )
    db.add(order)
    db.commit()
    path = _file(tmp_path, location.name)

    # Пробный прогон ничего не пишет
    assert run(db, path, commit=False, until=None) == 0
    assert db.scalars(select(Transaction)).first() is None

    assert run(db, path, commit=True, until=None) == 0
    txs = db.scalars(select(Transaction).order_by(Transaction.date)).all()
    assert [(t.amount, t.is_income, t.is_bank) for t in txs] == [
        (Decimal("22000"), True, False),
        (Decimal("1500"), True, True),
        (Decimal("146"), False, True),  # 145.5 → 146
        (Decimal("21000"), False, False),
        (Decimal("500"), True, False),
    ]
    paid = [t for t in txs if t.order_id]
    assert len(paid) == 1 and paid[0].order_id == order.id and "Татьяна" in paid[0].note
    assert "док. B003394" in txs[1].note  # чек без заказа — номер остаётся в примечании
    cash = db.scalars(select(CashRegister).where(CashRegister.name == "Касса Панфиловский")).one()
    terminal = db.scalars(select(CashRegister).where(CashRegister.name == "Терминал")).one()
    assert cash.cash_balance == Decimal("1500")  # 22000 − 21000 + 500
    assert terminal.bank_balance == Decimal("1354")  # 1500 − 146
    assert db.get(Order, order.id).paid == 500  # «оплачено» по заказу не задвоилось
    assert db.scalars(select(CashItem).where(CashItem.name == "Оплата за аренду")).one().is_income is True

    # Повторный запуск — отказ, деньги не задваиваются
    assert run(db, path, commit=True, until=None) == 1
    assert len(db.scalars(select(Transaction)).all()) == 5
    assert cash.cash_balance == Decimal("1500")


def test_unknown_register_is_reported_not_imported(db, tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER)
    ws.append(["", None, "01.09.2026 10:00", "Наличными", None, "Несуществующая касса", "Прочее", None, None, 100, 100, None])
    path = tmp_path / "t.xlsx"
    wb.save(path)
    assert run(db, str(path), commit=True, until=None) == 1
    assert db.scalars(select(Transaction)).first() is None


def test_set_balance(db, tmp_path):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    path = _file(tmp_path, location.name)
    register = db.scalars(select(CashRegister).where(CashRegister.name == "Касса Панфиловский")).one()
    assert run(db, path, True, None, ["Касса Панфиловский:нал:777"]) == 0
    db.refresh(register)
    assert register.cash_balance == 777
    assert db.scalars(select(Transaction).where(Transaction.note.like("%приведение остатка%"))).first()
