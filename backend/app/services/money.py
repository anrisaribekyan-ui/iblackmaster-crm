"""Деньги. ЕДИНСТВЕННОЕ место, где меняются остатки касс и балансы контрагентов.

Правила:
- amount всегда положительный, направление — от статьи (CashItem.is_income).
- Безнал (is_bank=True) и наличные учитываются раздельно: bank_balance / cash_balance.
- Приход безналом в кассу с bank_percent > 0 автоматически создаёт парный расход
  «Комиссия банка (эквайринг)».
- Статьи с affects_balance меняют баланс контрагента:
    приход от контрагента  → balance += amount (он нам заплатил)
    расход контрагенту     → balance -= amount (мы ему заплатили / вернули)
  Начисления (выданный заказ, продажа, поступление) двигают баланс через charge_counteragent().
- Удаление транзакции — мягкое (is_deleted), с полным откатом эффектов.
- Функции НЕ делают commit: коммитит вызывающий код (роутер), чтобы всё шло одной транзакцией БД.
"""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import MONEY_STEP, utcnow
from app.errors import BusinessError
from app.models import CashItem, CashItemType, CashRegister, Company, Counteragent, Order, Sale, StockDocument, Transaction

CENT = MONEY_STEP  # без копеек


def to_money(value) -> Decimal:
    """Приводит число к деньгам — целые рубли, без копеек. Принимает str/int/Decimal. float запрещён."""
    if isinstance(value, float):
        raise TypeError("Деньги нельзя передавать как float — используйте Decimal или строку")
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def get_system_item(db: Session, item_type: str, is_income: bool | None = None) -> CashItem:
    q = select(CashItem).where(CashItem.type == item_type)
    if is_income is not None:
        q = q.where(CashItem.is_income == is_income)
    item = db.scalars(q).first()
    if item is None:
        raise BusinessError(f"Не найдена системная статья «{item_type}». Запустите сид справочников.")
    return item


def check_date_lock(db: Session, date: datetime) -> None:
    company = db.scalars(select(Company)).first()
    if company and company.date_lock and date.date().isoformat() <= company.date_lock:
        raise BusinessError(f"Период до {company.date_lock} закрыт, изменения запрещены")


def _apply(db: Session, tx: Transaction, sign: int) -> None:
    """Применяет (sign=+1) или откатывает (sign=-1) влияние транзакции на остатки."""
    reg = db.get(CashRegister, tx.cash_register_id)
    delta = tx.signed_amount * sign
    if tx.is_bank:
        new_balance = reg.bank_balance + delta
        if new_balance < 0 and not reg.allow_negative and delta < 0:
            raise BusinessError(f"В кассе «{reg.name}» недостаточно безналичных средств")
        reg.bank_balance = new_balance
    else:
        new_balance = reg.cash_balance + delta
        if new_balance < 0 and not reg.allow_negative and delta < 0:
            raise BusinessError(f"В кассе «{reg.name}» недостаточно наличных")
        reg.cash_balance = new_balance
    if sign > 0:
        tx.balance_after = new_balance

    item = tx.cash_item or db.get(CashItem, tx.cash_item_id)
    if tx.counteragent_id and item.affects_balance:
        ca = db.get(Counteragent, tx.counteragent_id)
        ca.balance = ca.balance + delta


def _transaction_location(db: Session, reg: CashRegister, order_id, sale_id, stock_document_id) -> int | None:
    """Точка операции. У кассы точки — её точка; у общей кассы (терминал, перевод на карту) — точка заказа,
    чека или документа, иначе отчёты по точкам не увидят оплату через общую кассу."""
    if reg.location_id is not None:
        return reg.location_id
    for model, key in ((Order, order_id), (Sale, sale_id), (StockDocument, stock_document_id)):
        if key:
            doc = db.get(model, key)
            if doc is not None:
                return doc.location_id
    return None


def create_transaction(
    db: Session,
    *,
    cash_register_id: int,
    cash_item: CashItem,
    amount,
    is_bank: bool = False,
    date: datetime | None = None,
    counteragent_id: int | None = None,
    employee_id: int | None = None,
    created_by_id: int | None = None,
    order_id: int | None = None,
    sale_id: int | None = None,
    stock_document_id: int | None = None,
    note: str | None = None,
    with_bank_fee: bool = True,
) -> Transaction:
    amount = to_money(amount)
    if amount <= 0:
        raise BusinessError("Сумма должна быть больше нуля")
    reg = db.get(CashRegister, cash_register_id)
    if reg is None or not reg.is_active:
        raise BusinessError("Касса не найдена или в архиве")
    if is_bank and not reg.accepts_bank:
        raise BusinessError(f"Касса «{reg.name}» не принимает безналичные")
    if not is_bank and not reg.accepts_cash:
        raise BusinessError(f"Касса «{reg.name}» не принимает наличные")
    date = date or utcnow()
    check_date_lock(db, date)

    tx = Transaction(
        date=date,
        cash_register_id=reg.id,
        cash_item_id=cash_item.id,
        cash_item=cash_item,
        is_income=cash_item.is_income,
        is_bank=is_bank,
        amount=amount,
        location_id=_transaction_location(db, reg, order_id, sale_id, stock_document_id),
        counteragent_id=counteragent_id,
        employee_id=employee_id,
        created_by_id=created_by_id,
        order_id=order_id,
        sale_id=sale_id,
        stock_document_id=stock_document_id,
        note=note,
    )
    db.add(tx)
    _apply(db, tx, +1)
    db.flush()

    if with_bank_fee and is_bank and cash_item.is_income and reg.bank_percent > 0:
        fee = (amount * reg.bank_percent / 100).quantize(CENT, rounding=ROUND_HALF_UP)
        if fee > 0:
            fee_tx = create_transaction(
                db,
                cash_register_id=reg.id,
                cash_item=get_system_item(db, CashItemType.BANK_PERCENT),
                amount=fee,
                is_bank=True,
                date=date,
                created_by_id=created_by_id,
                order_id=order_id,
                sale_id=sale_id,
                note=f"Эквайринг {reg.bank_percent}%",
                with_bank_fee=False,
            )
            fee_tx.pair_id = tx.id
    return tx


def delete_transaction(db: Session, tx: Transaction) -> None:
    """Мягкое удаление с откатом остатков. Удаляет и связанные (комиссию, вторую ногу перемещения)."""
    if tx.is_deleted:
        return
    check_date_lock(db, tx.date)
    db.flush()  # autoflush выключен: сбрасываем pair_id и т.п. перед запросом
    linked = list(db.scalars(select(Transaction).where(Transaction.pair_id == tx.id, Transaction.is_deleted.is_(False))))
    item = tx.cash_item or db.get(CashItem, tx.cash_item_id)
    # Вверх по паре идём только для перемещений: удаление комиссии не должно удалять сам приход
    if tx.pair_id and item.type in (CashItemType.MOVE_TO, CashItemType.MOVE_FROM):
        other = db.get(Transaction, tx.pair_id)
        if other and not other.is_deleted:
            linked.append(other)
    _apply(db, tx, -1)
    tx.is_deleted = True
    for other in linked:
        if not other.is_deleted:
            _apply(db, other, -1)
            other.is_deleted = True


def restore_transaction(db: Session, tx: Transaction) -> None:
    if not tx.is_deleted:
        return
    check_date_lock(db, tx.date)
    tx.is_deleted = False
    _apply(db, tx, +1)


def move_money(
    db: Session,
    *,
    from_register_id: int,
    to_register_id: int,
    amount,
    is_bank: bool = False,
    created_by_id: int | None = None,
    note: str | None = None,
) -> tuple[Transaction, Transaction]:
    """Перемещение денег между кассами: две связанные транзакции."""
    if from_register_id == to_register_id:
        raise BusinessError("Выберите другую кассу")
    for reg_id in (from_register_id, to_register_id):
        reg = db.get(CashRegister, reg_id)
        if reg is None or not reg.allow_internal_move:
            raise BusinessError("Касса не допускает внутренние перемещения")
    out_tx = create_transaction(
        db,
        cash_register_id=from_register_id,
        cash_item=get_system_item(db, CashItemType.MOVE_FROM),
        amount=amount,
        is_bank=is_bank,
        created_by_id=created_by_id,
        note=note,
        with_bank_fee=False,
    )
    in_tx = create_transaction(
        db,
        cash_register_id=to_register_id,
        cash_item=get_system_item(db, CashItemType.MOVE_TO),
        amount=amount,
        is_bank=is_bank,
        created_by_id=created_by_id,
        note=note,
        with_bank_fee=False,
    )
    in_tx.pair_id = out_tx.id
    return out_tx, in_tx


def charge_counteragent(db: Session, counteragent_id: int | None, amount) -> None:
    """Начисление долга контрагенту (выдан заказ, продажа в долг): balance -= amount.

    Отрицательный amount — отмена начисления (заказ вернули из «Выданных»).
    """
    if not counteragent_id:
        return
    ca = db.get(Counteragent, counteragent_id)
    ca.balance = ca.balance - to_money(amount)
