"""Расчёт зарплаты как в LiveSklad (пишет и меняет только Claude).

Подход — «пересчёт целиком»: начисления по заказу/чеку не правятся по кусочкам, а пересобираются
из текущего состояния документа функцией recalc_order / recalc_sale. Поэтому любая правка заказа
(статус, позиции, скидка, удаление) просто вызывает пересчёт, и зарплата всегда совпадает с документом.
Ручные бонусы/штрафы (is_manual=True) пересчёт не трогает.

Правило (SalaryRule) выбирается самое узкое: общее < для локации < по типу заказа < локация + тип.
База: margin — валовая прибыль, summ — стоимость. Скидка за счёт сотрудника (discount_by=worker)
уменьшает базу, за счёт компании (company) — нет. Ступени steps: берётся последняя, где база >= from.
"""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import MONEY_STEP
from app.models import (
    AccrualKind,
    Order,
    OrderPosition,
    OrderStatus,
    Sale,
    SalaryEvent,
    SalaryRule,
    StatusGroup,
)

ZERO = Decimal("0")

# Какие виды начислений считаются по заказу и кому они идут
ORDER_KINDS = (
    AccrualKind.WORK_ORDER,
    AccrualKind.PRODUCT_ORDER,
    AccrualKind.NEW_ORDER,
    AccrualKind.MANAGER_ORDER,
    AccrualKind.CLOSED_ORDER,
)


def _rub(value: Decimal) -> Decimal:
    return value.quantize(MONEY_STEP, rounding=ROUND_HALF_UP)


def pick_rule(
    db: Session, employee_id: int, kind: AccrualKind, location_id: int | None, order_type_id: int | None
) -> SalaryRule | None:
    """Самое узкое подходящее правило сотрудника для вида начисления."""
    best: SalaryRule | None = None
    best_score = -1
    for rule in db.scalars(
        select(SalaryRule).where(SalaryRule.employee_id == employee_id, SalaryRule.kind == kind)
    ):
        if rule.location_id is not None and rule.location_id != location_id:
            continue
        if rule.order_type_id is not None and rule.order_type_id != order_type_id:
            continue
        score = (2 if rule.order_type_id is not None else 0) + (1 if rule.location_id is not None else 0)
        if score > best_score:
            best, best_score = rule, score
    return best


def apply_rule(rule: SalaryRule, base: Decimal, quantity: Decimal = Decimal("1")) -> tuple[Decimal, dict]:
    """Сумма начисления по правилу и базе. Возвращает (сумма, расшифровка)."""
    if base < 0 and not rule.subtract_negative_margin:
        return ZERO, {}
    steps = sorted(rule.steps or [], key=lambda s: Decimal(str(s.get("from", 0))))
    step = None
    for candidate in steps:
        if base >= Decimal(str(candidate.get("from", 0))):
            step = candidate
    if step is None:
        return ZERO, {}
    value = Decimal(str(step.get("value", 0)))
    if rule.value_type == "fixed":
        amount = value * quantity
    else:
        amount = base * value / 100
    if rule.max_amount is not None and amount > rule.max_amount:
        amount = rule.max_amount
    details = {"base": rule.base, "base_value": str(_rub(base)), "from": step.get("from", 0), "value": str(value), "value_type": rule.value_type}
    return _rub(amount), details


def _reached(order: Order, accrue_on: str) -> datetime | None:
    """Дата, с которой начисление действует, или None, если заказ ещё не дошёл до нужного статуса."""
    group = order.status.group
    if accrue_on == "close":
        return order.closed_at if group == StatusGroup.CLOSED else None
    if group in (StatusGroup.FINISH, StatusGroup.CLOSED):
        return order.finished_at or order.closed_at
    return None


def _order_discount_ratio(order: Order) -> Decimal:
    """Доля, которая остаётся от суммы позиций после скидки на весь заказ."""
    gross = sum((p.sold_price * p.quantity for p in order.positions), ZERO)
    if gross <= 0:
        return Decimal("1")
    return order.total_price / gross


def _position_base(rule: SalaryRule, position, ratio: Decimal) -> Decimal:
    unit = position.sold_price * ratio if rule.discount_by == "worker" else position.price
    revenue = unit * position.quantity
    if rule.base == "summ":
        return revenue
    return revenue - position.purchase_price * position.quantity


def _filtered(rule: SalaryRule, positions):
    options = rule.options or {}
    use_work = options.get("isWork", True)
    use_product = options.get("isProduct", True)
    return [p for p in positions if (p.is_work and use_work) or (not p.is_work and use_product)]


def recalc_order(db: Session, order: Order) -> None:
    """Пересобирает автоматические начисления по заказу из его текущего состояния."""
    db.execute(
        delete(SalaryEvent).where(SalaryEvent.order_id == order.id, SalaryEvent.is_manual.is_(False))
    )
    if order.is_deleted:
        return
    if order.status is None:
        order.status = db.get(OrderStatus, order.status_id)
    ratio = _order_discount_ratio(order)

    def add(employee_id, kind, rule, amount, details, date, position: OrderPosition | None = None):
        if amount == 0:
            return
        db.add(
            SalaryEvent(
                employee_id=employee_id,
                kind=kind,
                date=date,
                amount=amount,
                location_id=order.location_id,
                order_id=order.id,
                order_position_id=position.id if position is not None else None,
                rule_id=rule.id,
                details=details,
            )
        )

    # За работу и за запчасть — исполнителю каждой позиции
    for position in order.positions:
        if position.performer_id is None:
            continue
        kind = AccrualKind.WORK_ORDER if position.is_work else AccrualKind.PRODUCT_ORDER
        rule = pick_rule(db, position.performer_id, kind, order.location_id, order.order_type_id)
        if rule is None:
            continue
        date = _reached(order, rule.accrue_on)
        if date is None:
            continue
        amount, details = apply_rule(rule, _position_base(rule, position, ratio), position.quantity)
        add(position.performer_id, kind, rule, amount, details, date, position)

    # За заказ целиком — создавшему, менеджеру, выдавшему
    for kind, employee_id in (
        (AccrualKind.NEW_ORDER, order.created_by_id),
        (AccrualKind.MANAGER_ORDER, order.manager_id),
        (AccrualKind.CLOSED_ORDER, order.closed_by_id),
    ):
        if employee_id is None:
            continue
        rule = pick_rule(db, employee_id, kind, order.location_id, order.order_type_id)
        if rule is None:
            continue
        accrue_on = "close" if kind == AccrualKind.CLOSED_ORDER else rule.accrue_on
        date = _reached(order, accrue_on)
        if date is None:
            continue
        positions = _filtered(rule, order.positions)
        base = sum((_position_base(rule, p, ratio) for p in positions), ZERO)
        amount, details = apply_rule(rule, base)
        add(employee_id, kind, rule, amount, details, date)
    db.flush()  # сессия без autoflush: следующий пересчёт должен видеть эти строки


def recalc_sale(db: Session, sale: Sale) -> None:
    """Пересобирает начисление продавцу по чеку (с учётом возвратов)."""
    db.execute(delete(SalaryEvent).where(SalaryEvent.sale_id == sale.id, SalaryEvent.is_manual.is_(False)))
    if sale.is_deleted:
        return
    rule = pick_rule(db, sale.seller_id, AccrualKind.SALE_SHOP, sale.location_id, None)
    if rule is None:
        return
    base = ZERO
    for position in _filtered(rule, sale.positions):
        quantity = position.quantity if rule.keep_on_return else position.quantity - position.returned_quantity
        unit = position.sold_price if rule.discount_by == "worker" else position.price
        revenue = unit * quantity
        base += revenue if rule.base == "summ" else revenue - position.purchase_price * quantity
    amount, details = apply_rule(rule, base)
    if amount == 0:
        return
    db.add(
        SalaryEvent(
            employee_id=sale.seller_id,
            kind=AccrualKind.SALE_SHOP,
            date=sale.date,
            amount=amount,
            location_id=sale.location_id,
            sale_id=sale.id,
            rule_id=rule.id,
            details=details,
        )
    )
    db.flush()


def recalc_period(db: Session, date_from: datetime, date_to: datetime) -> int:
    """Кнопка «Пересчитать зарплату»: пересчёт всех заказов и чеков периода. Возвращает число документов."""
    count = 0
    orders = db.scalars(
        select(Order).where(
            ((Order.finished_at >= date_from) & (Order.finished_at < date_to))
            | ((Order.closed_at >= date_from) & (Order.closed_at < date_to))
        )
    ).all()
    for order in orders:
        recalc_order(db, order)
        count += 1
    for sale in db.scalars(select(Sale).where(Sale.date >= date_from, Sale.date < date_to)):
        recalc_sale(db, sale)
        count += 1
    return count
