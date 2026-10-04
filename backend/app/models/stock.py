"""Продажи (чеки) и складские документы."""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, Quantity, TimestampMixin, utcnow


class Sale(Base, TimestampMixin):
    """Чек продажи в локации."""

    __tablename__ = "sale"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True)
    date: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("location.id"), index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"))
    counteragent_id: Mapped[int | None] = mapped_column(ForeignKey("counteragent.id"))
    seller_id: Mapped[int] = mapped_column(ForeignKey("employee.id"))
    discount_percent: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    discount_sum: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    total_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    total_purchase: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    paid: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    note: Mapped[str | None] = mapped_column(Text)
    is_deleted: Mapped[bool] = mapped_column(default=False)

    positions: Mapped[list["SalePosition"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan"
    )


class SalePosition(Base):
    __tablename__ = "sale_position"

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sale.id", ondelete="CASCADE"), index=True)
    nomenclature_id: Mapped[int | None] = mapped_column(ForeignKey("nomenclature.id"))
    is_work: Mapped[bool] = mapped_column(default=False)
    name: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Quantity, default=Decimal("1"))
    price: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    sold_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    purchase_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    guarantee_days: Mapped[int] = mapped_column(default=0)
    serials: Mapped[list[str]] = mapped_column(JSON, default=list)
    returned_quantity: Mapped[Decimal] = mapped_column(Quantity, default=Decimal("0"))

    sale: Mapped[Sale] = relationship(back_populates="positions")


class StockDocType(str, enum.Enum):
    PURCHASE = "purchase"  # Поступление
    MOVE = "move"  # Перемещение
    CANCELLATION = "cancellation"  # Списание
    SALE_RETURN = "saleReturn"  # Возврат от клиента
    PURCHASE_RETURN = "purchaseReturn"  # Возврат поставщику
    INVENTORY = "inventory"  # Инвентаризация


STOCK_DOC_TITLES = {
    StockDocType.PURCHASE: "Поступление",
    StockDocType.MOVE: "Перемещение",
    StockDocType.CANCELLATION: "Списание",
    StockDocType.SALE_RETURN: "Возврат от клиента",
    StockDocType.PURCHASE_RETURN: "Возврат поставщику",
    StockDocType.INVENTORY: "Инвентаризация",
}


class StockDocument(Base, TimestampMixin):
    __tablename__ = "stock_document"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[StockDocType] = mapped_column(String(20), index=True)
    number: Mapped[str] = mapped_column(String(20))
    date: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("location.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"))
    # Для перемещения — склад назначения
    to_store_id: Mapped[int | None] = mapped_column(ForeignKey("store.id"))
    counteragent_id: Mapped[int | None] = mapped_column(ForeignKey("counteragent.id"))  # поставщик
    sale_id: Mapped[int | None] = mapped_column(ForeignKey("sale.id"))  # для возврата от клиента
    ext_number: Mapped[str | None] = mapped_column(String(50))  # вход. номер документа поставщика
    ext_date: Mapped[datetime | None]
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    note: Mapped[str | None] = mapped_column(Text)
    total: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    paid: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    # Проведён ли документ (изменил остатки). Инвентаризация проводится кнопкой «Закончить».
    is_posted: Mapped[bool] = mapped_column(default=False)
    is_deleted: Mapped[bool] = mapped_column(default=False)

    positions: Mapped[list["StockDocumentPosition"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class StockDocumentPosition(Base):
    __tablename__ = "stock_document_position"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("stock_document.id", ondelete="CASCADE"), index=True
    )
    nomenclature_id: Mapped[int] = mapped_column(ForeignKey("nomenclature.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity, default=Decimal("0"))
    # Для инвентаризации: количество по учёту на момент заполнения
    quantity_accounted: Mapped[Decimal | None] = mapped_column(Quantity)
    price: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # закупочная цена единицы
    serials: Mapped[list[str]] = mapped_column(JSON, default=list)

    document: Mapped[StockDocument] = relationship(back_populates="positions")
