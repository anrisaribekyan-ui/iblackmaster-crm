"""Балансы клиентов и поставщиков в продажах и поступлениях. Тесты Claude — не ослаблять и не удалять.

Правило знака: Counteragent.balance > 0 — мы должны контрагенту, < 0 — он должен нам.
"""

from decimal import Decimal

from sqlalchemy import select

from app.models import CashRegister, Counteragent, Location, Nomenclature, StockDocType
from app.services import sales, stock, stock_documents


def _setup(db):
    loc = db.scalars(select(Location).where(Location.name.contains("Панфиловский"))).one()
    store = loc.stores[0]
    reg = db.scalars(select(CashRegister).where(CashRegister.name == "Касса Панфиловский")).one()
    nom = Nomenclature(code=9001, name="Чехол", is_work=False)
    client = Counteragent(name="Клиент", phones="79990000001")
    vendor = Counteragent(name="Поставщик", phones="79990000002", is_vendor=True, is_buyer=False)
    db.add_all([nom, client, vendor])
    db.flush()
    stock.receive(db, store.id, nom.id, "10", "100")
    return loc, store, reg, nom, client, vendor


def _sale(db, owner, loc, store, reg, nom, client, paid):
    return sales.create_sale(
        db,
        location_id=loc.id,
        store_id=store.id,
        seller_id=owner.id,
        counteragent_id=client.id,
        discount_percent=Decimal("0"),
        discount_sum=Decimal("0"),
        note=None,
        positions=[{"nomenclature_id": nom.id, "quantity": "2", "price": "500"}],
        payments=[{"cash_register_id": reg.id, "amount": paid, "is_bank": False}] if paid != "0" else [],
    )


def test_fully_paid_sale_leaves_client_balance_zero(db, owner):
    loc, store, reg, nom, client, _ = _setup(db)
    _sale(db, owner, loc, store, reg, nom, client, "1000")
    assert client.balance == Decimal("0")


def test_sale_on_credit_makes_client_debtor(db, owner):
    loc, store, reg, nom, client, _ = _setup(db)
    _sale(db, owner, loc, store, reg, nom, client, "400")
    assert client.balance == Decimal("-600")


def test_sale_refund_keeps_client_balance_zero(db, owner):
    loc, store, reg, nom, client, _ = _setup(db)
    sale = _sale(db, owner, loc, store, reg, nom, client, "1000")
    sales.refund_sale(
        db, sale=sale, employee_id=owner.id, cash_register_id=reg.id, is_bank=False, note=None,
        items=[{"sale_position_id": sale.positions[0].id, "quantity": "1"}],
    )
    assert client.balance == Decimal("0")
    assert reg.cash_balance == Decimal("500")


def _purchase(db, owner, loc, store, nom, vendor, reg=None, amount=None):
    return stock_documents.create_document(
        db,
        doc_type=StockDocType.PURCHASE,
        location_id=loc.id,
        store_id=store.id,
        to_store_id=None,
        counteragent_id=vendor.id,
        responsible_id=owner.id,
        note=None,
        positions=[{"nomenclature_id": nom.id, "quantity": "5", "price": "200"}],
        cash_register_id=reg.id if reg else None,
        amount=amount,
    )


def test_unpaid_purchase_means_we_owe_vendor(db, owner):
    loc, store, _, nom, _, vendor = _setup(db)
    _purchase(db, owner, loc, store, nom, vendor)
    assert vendor.balance == Decimal("1000")


def test_paid_purchase_leaves_vendor_balance_zero(db, owner):
    loc, store, reg, nom, _, vendor = _setup(db)
    reg.cash_balance = Decimal("5000")
    _purchase(db, owner, loc, store, nom, vendor, reg, Decimal("1000"))
    assert vendor.balance == Decimal("0")


def test_partially_paid_purchase_and_delete(db, owner):
    loc, store, reg, nom, _, vendor = _setup(db)
    reg.cash_balance = Decimal("5000")
    doc = _purchase(db, owner, loc, store, nom, vendor, reg, Decimal("300"))
    assert vendor.balance == Decimal("700")
    stock_documents.delete_document(db, doc)
    assert vendor.balance == Decimal("0")
    assert reg.cash_balance == Decimal("5000")


def test_money_has_no_kopecks():
    from decimal import Decimal

    from app.services import money

    assert money.to_money("1499.50") == Decimal("1500")
    assert money.to_money("1499.49") == Decimal("1499")
