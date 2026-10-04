"""Деньги: статьи движения денег и транзакции."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin, utcnow


class CashItemType:
    """Системные типы статей. Документы находят свою статью по типу, а не по имени."""

    ORDER = "order"  # Оплата за заказ (приход)
    ORDER_RETURN = "orderReturn"  # Возврат покупателю за заказ (расход)
    SALE = "sale"  # Оплата чека (приход)
    SALE_RETURN = "saleReturn"  # Возврат покупателю по чеку (расход)
    INVOICE = "invoice"  # Оплата по счёту (приход)
    PURCHASE = "purchase"  # Оплата за товар поставщику (расход)
    PURCHASE_RETURN = "purchaseReturn"  # Возврат товара поставщику (приход)
    PRODUCT_MOVE = "productMove"  # Оплата за перемещение (приход)
    PRODUCT_MOVE_FROM = "productMoveFrom"  # Оплата за перемещение (расход)
    MOVE_TO = "moveFrom"  # Перемещение денег В кассу (приход) — имя как в LiveSklad
    MOVE_FROM = "move"  # Перемещение денег ИЗ кассы (расход)
    SALARY = "salary"  # Выплата зарплаты (расход)
    COLLECTION = "collection"  # Инкассация (расход)
    BANK_PERCENT = "bankPercent"  # Комиссия банка (расход)


class CashItem(Base):
    """Статья движения денег. type=NULL — пользовательская статья для ручных операций."""

    __tablename__ = "cash_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    is_income: Mapped[bool]
    type: Mapped[str | None] = mapped_column(String(30))
    # Влияет ли на баланс (долг) контрагента
    affects_balance: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)


class Transaction(Base, TimestampMixin):
    """Одно движение денег по одной кассе.

    amount всегда > 0. Направление задаёт cash_item.is_income.
    Создавать, менять и удалять — ТОЛЬКО через app.services.money.
    """

    __tablename__ = "transaction"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    cash_register_id: Mapped[int] = mapped_column(ForeignKey("cash_register.id"), index=True)
    cash_item_id: Mapped[int] = mapped_column(ForeignKey("cash_item.id"))
    is_income: Mapped[bool]  # копия cash_item.is_income на момент проводки
    is_bank: Mapped[bool] = mapped_column(default=False)  # безнал
    amount: Mapped[Decimal]
    # Остаток кассы (по нужному виду: нал/безнал) сразу после этой операции
    balance_after: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))

    counteragent_id: Mapped[int | None] = mapped_column(ForeignKey("counteragent.id"), index=True)
    # Для зарплаты и выдач работнику — кому
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))

    # Связанный документ (заполнено не более одного)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id"), index=True)
    sale_id: Mapped[int | None] = mapped_column(ForeignKey("sale.id"), index=True)
    stock_document_id: Mapped[int | None] = mapped_column(ForeignKey("stock_document.id"))
    # Парная транзакция: перемещение между кассами, комиссия банка к приходу
    pair_id: Mapped[int | None] = mapped_column(ForeignKey("transaction.id"))

    note: Mapped[str | None] = mapped_column(Text)
    is_deleted: Mapped[bool] = mapped_column(default=False)

    cash_item: Mapped[CashItem] = relationship()
    cash_register: Mapped["CashRegister"] = relationship()  # noqa: F821

    @property
    def signed_amount(self) -> Decimal:
        return self.amount if self.is_income else -self.amount
