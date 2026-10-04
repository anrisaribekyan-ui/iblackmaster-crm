"""Бизнес-логика заказа. Роутеры вызывают эти функции и делают db.commit().

Здесь живут: нумерация, пересчёт сумм, позиции (со списанием со склада),
смена статуса (права, оплата, даты, баланс клиента), оплаты и возвраты, история.
"""

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.errors import BusinessError, Forbidden
from app.models import (
    CashItemType,
    Company,
    Employee,
    Nomenclature,
    Order,
    OrderHistory,
    OrderPosition,
    OrderStatus,
    StatusGroup,
    Transaction,
)
from app.services import money, stock

CENT = Decimal("0.01")


# --- Нумерация ---------------------------------------------------------------------


def next_order_number(db: Session) -> str:
    """Сквозной номер заказа по компании: A15843. Блокирует строку компании до конца транзакции."""
    company = db.scalars(select(Company).with_for_update()).first()
    if company is None:
        raise BusinessError("Компания не настроена. Запустите сид.")
    number = f"{company.order_number_prefix}{company.next_order_number}"
    company.next_order_number += 1
    return number


# --- История -----------------------------------------------------------------------


def add_history(
    db: Session,
    order: Order,
    type_: str,
    employee: Employee | None,
    text: str | None = None,
    status_id: int | None = None,
    **data,
) -> OrderHistory:
    h = OrderHistory(
        order_id=order.id,
        type=type_,
        employee_id=employee.id if employee else None,
        text=text,
        status_id=status_id,
        data={k: (str(v) if isinstance(v, Decimal) else v) for k, v in data.items()},
    )
    db.add(h)
    order.last_action_at = utcnow()
    return h


# --- Суммы -------------------------------------------------------------------------


def recalc_totals(order: Order) -> None:
    """Пересчитывает total_price и total_purchase по позициям и скидке заказа."""
    gross = sum((p.total for p in order.positions), Decimal("0"))
    purchase = sum(((p.purchase_price * p.quantity) for p in order.positions), Decimal("0"))
    discount = Decimal("0")
    if order.discount_percent:
        discount += (gross * order.discount_percent / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    discount += order.discount_sum or Decimal("0")
    order.total_price = max(gross - discount, Decimal("0")).quantize(CENT)
    order.total_purchase = purchase.quantize(CENT)


def _ensure_editable(order: Order) -> None:
    if order.is_deleted:
        raise BusinessError("Заказ удалён")
    if order.status.group == StatusGroup.CLOSED:
        raise BusinessError("Заказ выдан. Чтобы изменить позиции, верните его в работу")


# --- Позиции -----------------------------------------------------------------------


def add_position(
    db: Session,
    order: Order,
    employee: Employee,
    *,
    nomenclature_id: int | None = None,
    name: str | None = None,
    is_work: bool | None = None,
    quantity="1",
    price=None,
    performer_id: int | None = None,
    store_id: int | None = None,
    guarantee_days: int | None = None,
) -> OrderPosition:
    """Добавляет работу или запчасть. Запчасть со склада списывается сразу (store_id обязателен)."""
    _ensure_editable(order)
    qty = stock.to_qty(quantity)
    nom = db.get(Nomenclature, nomenclature_id) if nomenclature_id else None
    if nomenclature_id and nom is None:
        raise BusinessError("Позиция справочника не найдена")
    if nom is None and not name:
        raise BusinessError("Укажите название позиции")
    work = nom.is_work if nom else bool(is_work)
    unit_price = money.to_money(price if price is not None else "0")

    purchase_price = Decimal("0")
    if nom is not None and not nom.is_work:
        if store_id is None:
            raise BusinessError("Выберите склад, с которого списать запчасть")
        purchase_price = stock.write_off(db, store_id, nom.id, qty)
    elif nom is not None:
        purchase_price = nom.purchase_price

    pos = OrderPosition(
        order_id=order.id,
        nomenclature_id=nom.id if nom else None,
        is_work=work,
        name=name or nom.name,
        quantity=qty,
        price=unit_price,
        sold_price=unit_price,
        purchase_price=purchase_price,
        guarantee_days=guarantee_days if guarantee_days is not None else (nom.guarantee_days if nom else 0),
        performer_id=performer_id or order.master_id or employee.id,
        store_id=store_id if (nom is not None and not nom.is_work) else None,
    )
    order.positions.append(pos)
    db.flush()
    recalc_totals(order)
    add_history(
        db, order, "add_work" if work else "add_product", employee,
        text=f"{pos.name} × {qty.normalize()} по {unit_price}", position_id=pos.id,
    )
    return pos


def remove_position(db: Session, order: Order, position: OrderPosition, employee: Employee) -> None:
    _ensure_editable(order)
    if position.order_id != order.id:
        raise BusinessError("Позиция не из этого заказа")
    if position.store_id and position.nomenclature_id:
        stock.return_to_stock(db, position.store_id, position.nomenclature_id, position.quantity, position.purchase_price)
    add_history(
        db, order, "delete_work" if position.is_work else "delete_product", employee,
        text=f"{position.name} × {position.quantity.normalize()}",
    )
    order.positions.remove(position)
    db.flush()
    recalc_totals(order)


def update_position_price(
    db: Session, order: Order, position: OrderPosition, employee: Employee, *, price=None, sold_price=None
) -> None:
    """Меняет цену/цену со скидкой. Ниже минимальной — только с правом minPriceAccess (проверяет роутер)."""
    _ensure_editable(order)
    if price is not None:
        position.price = money.to_money(price)
        position.sold_price = position.price
    if sold_price is not None:
        position.sold_price = money.to_money(sold_price)
    recalc_totals(order)
    add_history(
        db, order, "change_work" if position.is_work else "change_product", employee,
        text=f"{position.name}: цена {position.sold_price}",
    )


# --- Статусы -----------------------------------------------------------------------


def _role_can(status: OrderStatus, role_id: int, action: str) -> bool:
    access = (status.role_access or {}).get(str(role_id))
    if access is None:
        return True
    return bool(access.get(action, True))


def change_status(
    db: Session, order: Order, new_status: OrderStatus, employee: Employee, comment: str | None = None
) -> None:
    old = order.status
    if old.id == new_status.id:
        return
    if not new_status.is_active:
        raise BusinessError("Статус отключён")
    role_id = employee.role_id
    if not employee.is_owner:
        if not _role_can(old, role_id, "change"):
            raise Forbidden(f"Вашей роли нельзя менять статус «{old.name}»")
        if not _role_can(new_status, role_id, "set"):
            raise Forbidden(f"Вашей роли нельзя ставить статус «{new_status.name}»")
    if new_status.comment_mode == "required" and not (comment or "").strip():
        raise BusinessError(f"Для статуса «{new_status.name}» нужен комментарий")
    if new_status.pay_required and order.debt > 0:
        raise BusinessError(f"Заказ не оплачен: долг {order.debt} руб. Сначала примите оплату")

    now = utcnow()
    was_closed = old.group == StatusGroup.CLOSED
    becomes_closed = new_status.group == StatusGroup.CLOSED

    if new_status.group == StatusGroup.FINISH and order.finished_at is None:
        order.finished_at = now
    if becomes_closed and not was_closed:
        order.closed_at = now
        order.closed_by_id = employee.id
        if order.finished_at is None:
            order.finished_at = now
        # Выданный заказ становится начислением клиенту
        money.charge_counteragent(db, order.counteragent_id, order.total_price)
    if was_closed and not becomes_closed:
        money.charge_counteragent(db, order.counteragent_id, -order.total_price)
        order.closed_at = None
        order.closed_by_id = None

    order.status_id = new_status.id
    order.status = new_status
    add_history(db, order, "status", employee, text=comment, status_id=new_status.id, from_status_id=old.id)


# --- Оплаты ------------------------------------------------------------------------


def pay(
    db: Session, order: Order, employee: Employee, *, cash_register_id: int, amount, is_bank: bool, note: str | None = None
) -> Transaction:
    if order.is_deleted:
        raise BusinessError("Заказ удалён")
    tx = money.create_transaction(
        db,
        cash_register_id=cash_register_id,
        cash_item=money.get_system_item(db, CashItemType.ORDER),
        amount=amount,
        is_bank=is_bank,
        counteragent_id=order.counteragent_id,
        created_by_id=employee.id,
        order_id=order.id,
        note=note,
    )
    order.paid = order.paid + tx.amount
    add_history(db, order, "payment", employee, text=f"{tx.amount} руб, {'безнал' if is_bank else 'наличные'}", transaction_id=tx.id)
    return tx


def refund(
    db: Session, order: Order, employee: Employee, *, cash_register_id: int, amount, is_bank: bool, note: str | None = None
) -> Transaction:
    amount = money.to_money(amount)
    if amount > order.paid:
        raise BusinessError(f"Нельзя вернуть больше, чем оплачено ({order.paid} руб)")
    tx = money.create_transaction(
        db,
        cash_register_id=cash_register_id,
        cash_item=money.get_system_item(db, CashItemType.ORDER_RETURN),
        amount=amount,
        is_bank=is_bank,
        counteragent_id=order.counteragent_id,
        created_by_id=employee.id,
        order_id=order.id,
        note=note,
    )
    order.paid = order.paid - tx.amount
    add_history(db, order, "refund", employee, text=f"{tx.amount} руб", transaction_id=tx.id)
    return tx


def delete_payment(db: Session, order: Order, tx: Transaction, employee: Employee) -> None:
    if tx.order_id != order.id:
        raise BusinessError("Транзакция не из этого заказа")
    was_income = tx.is_income
    amount = tx.amount
    money.delete_transaction(db, tx)
    order.paid = order.paid - amount if was_income else order.paid + amount
    add_history(db, order, "delete_cash", employee, text=f"{amount} руб", transaction_id=tx.id)
