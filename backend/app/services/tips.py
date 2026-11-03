"""Чаевые: деньги идут в кассу отдельной статьёй (не в выручку заказа/чека), половина начисляется сотруднику."""

from decimal import ROUND_DOWN, Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.errors import BusinessError
from app.models import CashItemType, Employee, Order, Sale, Transaction
from app.models.salary import AccrualKind, SalaryEvent
from app.services import money

EMPLOYEE_SHARE = Decimal("0.5")


def is_tip(tx: Transaction) -> bool:
    item = tx.cash_item or None
    return bool(item and item.type == CashItemType.TIP)


def add_tip(
    db: Session, *, order: Order | None = None, sale: Sale | None = None, me: Employee,
    cash_register_id: int, amount, is_bank: bool, employee_id: int | None = None,
) -> Transaction:
    doc = order or sale
    if doc is None or doc.is_deleted:
        raise BusinessError("Документ не найден")
    receiver = employee_id or (order.master_id if order else sale.seller_id) or me.id
    if db.get(Employee, receiver) is None:
        raise BusinessError("Сотрудник не найден")
    tx = money.create_transaction(
        db,
        cash_register_id=cash_register_id,
        cash_item=money.get_system_item(db, CashItemType.TIP),
        amount=amount,
        is_bank=is_bank,
        counteragent_id=doc.counteragent_id,
        employee_id=receiver,
        created_by_id=me.id,
        order_id=order.id if order else None,
        sale_id=sale.id if sale else None,
        note="Чаевые",
        with_bank_fee=True,
    )
    share = (tx.amount * EMPLOYEE_SHARE).quantize(Decimal("1"), rounding=ROUND_DOWN)
    if share > 0:
        db.add(SalaryEvent(
            employee_id=receiver, kind=AccrualKind.TIP.value, date=tx.date, amount=share,
            location_id=tx.location_id, order_id=tx.order_id, sale_id=tx.sale_id,
            details={"tx": tx.id, "tip": str(tx.amount)}, is_manual=True,
            note=f"50% чаевых {tx.amount} руб", created_by_id=me.id,
        ))
    return tx


def remove_tip_events(db: Session, tx: Transaction) -> None:
    for ev in db.scalars(select(SalaryEvent).where(SalaryEvent.kind == AccrualKind.TIP.value)):
        if (ev.details or {}).get("tx") == tx.id:
            db.execute(delete(SalaryEvent).where(SalaryEvent.id == ev.id))
