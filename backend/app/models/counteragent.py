"""Контрагенты: клиенты и поставщики в одном справочнике."""

from decimal import Decimal

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin


class CounteragentType(Base):
    """«Частное лицо», «Компания». У каждого типа своя форма полей (см. FormField)."""

    __tablename__ = "counteragent_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(default=0)


class HowKnow(Base):
    """Рекламный источник: Авито, Яндекс, Сарафанное радио…"""

    __tablename__ = "how_know"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True)


class Counteragent(Base, TimestampMixin):
    __tablename__ = "counteragent"

    id: Mapped[int] = mapped_column(primary_key=True)
    type_id: Mapped[int | None] = mapped_column(ForeignKey("counteragent_type.id"))
    name: Mapped[str] = mapped_column(String(300), index=True)
    # Телефоны храним нормализованными: только цифры, 79161866119. Через запятую.
    phones: Mapped[str | None] = mapped_column(String(300), index=True)
    email: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    telegram: Mapped[str | None] = mapped_column(String(100))
    max_messenger: Mapped[str | None] = mapped_column(String(100))
    inn: Mapped[str | None] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text)
    how_know_id: Mapped[int | None] = mapped_column(ForeignKey("how_know.id"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))

    is_buyer: Mapped[bool] = mapped_column(default=True)
    is_vendor: Mapped[bool] = mapped_column(default=False)
    rating: Mapped[int] = mapped_column(default=0)
    allow_sms: Mapped[bool] = mapped_column(default=True)
    allow_email: Mapped[bool] = mapped_column(default=True)
    allow_telegram: Mapped[bool] = mapped_column(default=True)
    allow_max: Mapped[bool] = mapped_column(default=True)

    # Баланс: >0 — мы должны контрагенту (переплата), <0 — он должен нам.
    # Меняет ТОЛЬКО app.services.money.
    balance: Mapped[Decimal] = mapped_column(default=Decimal("0"))

    # Реквизиты юрлица и паспортные данные, а также пользовательские поля
    extra: Mapped[dict] = mapped_column(JSON, default=dict)

    is_deleted: Mapped[bool] = mapped_column(default=False)

    type: Mapped[CounteragentType | None] = relationship()
    how_know: Mapped[HowKnow | None] = relationship()
