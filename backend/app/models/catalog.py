"""Справочники: номенклатура (товары и работы), цены, остатки, устройства, неисправности."""

from decimal import Decimal

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, Quantity, TimestampMixin


class Measure(Base):
    """Единица измерения: шт, м, л…"""

    __tablename__ = "measure"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(30))
    is_float: Mapped[bool] = mapped_column(default=False)  # можно ли дробное количество


class PriceType(Base):
    """Тип цены: Розничная, Ремонтная, Минимальная."""

    __tablename__ = "price_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # Ровно один тип помечен как минимальная цена: ниже неё продавать без права нельзя
    is_minimal: Mapped[bool] = mapped_column(default=False)
    sort: Mapped[int] = mapped_column(default=0)


class NomenclatureGroup(Base):
    """Группа товаров/работ (дерево). Может задавать свои правила зарплаты."""

    __tablename__ = "nomenclature_group"

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("nomenclature_group.id"))
    name: Mapped[str] = mapped_column(String(200))
    # Зарплата по группе (этап 2): процент ИЛИ фикс
    salary_percent: Mapped[Decimal | None]
    salary_fixed: Mapped[Decimal | None]


class Nomenclature(Base, TimestampMixin):
    """Товар (запчасть) или работа (is_work=True)."""

    __tablename__ = "nomenclature"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[int] = mapped_column(unique=True)  # автонумерация
    article: Mapped[str | None] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    is_work: Mapped[bool] = mapped_column(default=False)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("nomenclature_group.id"))
    measure_id: Mapped[int | None] = mapped_column(ForeignKey("measure.id"))
    # Закупочная цена по умолчанию (для работ — себестоимость, обычно 0)
    purchase_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    guarantee_days: Mapped[int] = mapped_column(default=0)
    min_count: Mapped[Decimal] = mapped_column(Quantity, default=Decimal("0"))
    has_serials: Mapped[bool] = mapped_column(default=False)
    note: Mapped[str | None] = mapped_column(Text)
    # Зарплата по карточке (этап 2)
    salary_percent: Mapped[Decimal | None]
    salary_fixed: Mapped[Decimal | None]
    is_deleted: Mapped[bool] = mapped_column(default=False)

    group: Mapped[NomenclatureGroup | None] = relationship()
    measure: Mapped[Measure | None] = relationship()
    prices: Mapped[list["NomenclaturePrice"]] = relationship(cascade="all, delete-orphan")


class NomenclaturePrice(Base):
    """Цена товара/работы по типу цены. location_id=NULL — для всех локаций."""

    __tablename__ = "nomenclature_price"
    __table_args__ = (UniqueConstraint("nomenclature_id", "price_type_id", "location_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    nomenclature_id: Mapped[int] = mapped_column(ForeignKey("nomenclature.id", ondelete="CASCADE"))
    price_type_id: Mapped[int] = mapped_column(ForeignKey("price_type.id"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))
    price: Mapped[Decimal] = mapped_column(default=Decimal("0"))


class StockBalance(Base):
    """Остаток товара на складе. Меняет ТОЛЬКО app.services.stock."""

    __tablename__ = "stock_balance"
    __table_args__ = (UniqueConstraint("store_id", "nomenclature_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"))
    nomenclature_id: Mapped[int] = mapped_column(ForeignKey("nomenclature.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity, default=Decimal("0"))
    # Средняя закупочная цена единицы (скользящая средняя)
    avg_purchase_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))


# --- Устройства и неисправности -------------------------------------------------


class DeviceType(Base):
    """Тип устройства: Телефон, Ноутбук, Планшет…"""

    __tablename__ = "device_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    salary_percent: Mapped[Decimal | None]
    salary_fixed: Mapped[Decimal | None]


class Brand(Base):
    __tablename__ = "brand"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_type_id: Mapped[int | None] = mapped_column(ForeignKey("device_type.id"))
    name: Mapped[str] = mapped_column(String(100))


class DeviceModel(Base):
    __tablename__ = "device_model"

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brand.id"))
    name: Mapped[str] = mapped_column(String(200))


class Problem(Base):
    """Типовая неисправность для быстрого ввода."""

    __tablename__ = "problem"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))


class CompleteSet(Base):
    """Комплектация для быстрого ввода: зарядка, чехол, сим-карта…"""

    __tablename__ = "complete_set"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
