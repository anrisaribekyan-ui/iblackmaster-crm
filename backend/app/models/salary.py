"""Зарплата (этап 2). Схема заложена сейчас, чтобы позиции заказа и транзакции её учитывали.

Логику расчёта пишет Claude, не DeepSeek: см. docs/spec/07-salary.md.
"""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin, utcnow


class AccrualKind(str, enum.Enum):
    WORK_ORDER = "workOrder"  # За выполненную работу (исполнителю позиции)
    PRODUCT_ORDER = "productOrder"  # За установленную запчасть
    NEW_ORDER = "newOrder"  # За новый заказ (создавшему)
    MANAGER_ORDER = "managerOrder"  # За ведение заказа (менеджеру заказа)
    CLOSED_ORDER = "closedOrder"  # За выдачу заказа (выдавшему)
    SALE_SHOP = "saleShop"  # За продажу (продавцу чека)
    MONEY = "money"  # Оклад
    REVENUE = "revenue"  # Премия от оборота
    BONUS = "bonus"  # Бонус (вручную)
    PENALTY = "penalty"  # Штраф (вручную)


class SalaryRule(Base, TimestampMixin):
    """Правило начисления сотруднику.

    Область (чем уже, тем приоритетнее): общее → location_id → order_type_id → оба.
    base: summ (стоимость) | margin (валовая прибыль) | money (фиксированная сумма)
    value_type: percent | fixed
    steps: лесенка [{"from": 0, "value": 20}, {"from": 5000, "value": 25}] — берётся
           последняя ступень, где сумма >= from.
    accrue_on: finish (по готовности заказа) | close (по выдаче)
    discount_by: company | worker — чья скидка уменьшает базу расчёта
    max_amount: потолок одного начисления, NULL — без ограничения
    options: доп. флаги вида {"isWork": true, "isProduct": true, "isReturn": true} для продаж,
             {"period": "month|period|day", "weekdays": [1,2,3]} для оклада,
             {"revenueOf": "company|customer|counteragent", ...} для премии.
    """

    __tablename__ = "salary_rule"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id", ondelete="CASCADE"), index=True)
    kind: Mapped[AccrualKind] = mapped_column(String(20))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))
    order_type_id: Mapped[int | None] = mapped_column(ForeignKey("order_type.id"))
    base: Mapped[str] = mapped_column(String(10), default="margin")
    value_type: Mapped[str] = mapped_column(String(10), default="percent")
    steps: Mapped[list[dict]] = mapped_column(JSON, default=list)
    accrue_on: Mapped[str] = mapped_column(String(10), default="finish")
    discount_by: Mapped[str] = mapped_column(String(10), default="worker")
    subtract_negative_margin: Mapped[bool] = mapped_column(default=False)
    keep_on_return: Mapped[bool] = mapped_column(default=False)
    max_amount: Mapped[Decimal | None]
    options: Mapped[dict] = mapped_column(JSON, default=dict)


class SalaryEvent(Base):
    """Одно начисление/удержание. Выплаты — это транзакции со статьёй salary (финансы)."""

    __tablename__ = "salary_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), index=True)
    kind: Mapped[AccrualKind] = mapped_column(String(20))
    date: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    amount: Mapped[Decimal]  # штраф хранится отрицательным
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id"), index=True)
    order_position_id: Mapped[int | None] = mapped_column(
        ForeignKey("order_position.id", ondelete="SET NULL")
    )
    sale_id: Mapped[int | None] = mapped_column(ForeignKey("sale.id"))
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("salary_rule.id", ondelete="SET NULL"))
    # Расшифровка: {"base": "margin", "from": 3000, "percent": 20}
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    is_manual: Mapped[bool] = mapped_column(default=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
