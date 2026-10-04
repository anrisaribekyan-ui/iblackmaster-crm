"""Компания, локации (точки), склады, кассы."""

from decimal import Decimal

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin


class Company(Base, TimestampMixin):
    """Одна запись на всю систему (пока без франшизного режима)."""

    __tablename__ = "company"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    inn: Mapped[str | None] = mapped_column(String(20))
    kpp: Mapped[str | None] = mapped_column(String(20))
    ogrn: Mapped[str | None] = mapped_column(String(20))
    director: Mapped[str | None] = mapped_column(String(200))
    position: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(10), default="RUB")
    # Префикс номера заказа: A15842 → prefix "A"
    order_number_prefix: Mapped[str] = mapped_column(String(10), default="A")
    # Следующий номер заказа (сквозная нумерация по компании)
    next_order_number: Mapped[int] = mapped_column(default=1)
    next_sale_number: Mapped[int] = mapped_column(default=1)
    # Закрытие периода: до этой даты (включительно) данные менять нельзя
    date_lock: Mapped[str | None] = mapped_column(String(10))


class Location(Base, TimestampMixin):
    """Точка (сервисный центр). В LiveSklad называется «локация» / shop."""

    __tablename__ = "location"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    phones: Mapped[str | None] = mapped_column(String(300))  # через запятую
    color: Mapped[str] = mapped_column(String(9), default="#171717")
    sort: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)

    stores: Mapped[list["Store"]] = relationship(back_populates="location")
    cash_registers: Mapped[list["CashRegister"]] = relationship(back_populates="location")


class Store(Base, TimestampMixin):
    """Склад. У локации может быть несколько складов."""

    __tablename__ = "store"

    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("location.id"))
    name: Mapped[str] = mapped_column(String(200))
    is_default: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)

    location: Mapped[Location] = relationship(back_populates="stores")


class CashRegister(Base, TimestampMixin):
    """Касса. location_id = NULL — глобальная касса, общая для всех точек (например, терминал).

    Остатки (cash_balance / bank_balance) меняет ТОЛЬКО app.services.money.
    Нигде больше не присваивать эти поля напрямую.
    """

    __tablename__ = "cash_register"

    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))
    name: Mapped[str] = mapped_column(String(200))
    accepts_cash: Mapped[bool] = mapped_column(default=True)
    accepts_bank: Mapped[bool] = mapped_column(default=False)
    # Комиссия банка (эквайринг), % от безналичного прихода. 9.7 → 9.70
    bank_percent: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    allow_negative: Mapped[bool] = mapped_column(default=True)
    allow_internal_move: Mapped[bool] = mapped_column(default=True)
    is_default: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)

    cash_balance: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    bank_balance: Mapped[Decimal] = mapped_column(default=Decimal("0"))

    location: Mapped[Location | None] = relationship(back_populates="cash_registers")
