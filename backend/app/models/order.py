"""Заказы (ремонт): типы, статусы, формы полей, сам заказ, позиции, история."""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, Quantity, TimestampMixin, utcnow


class StatusGroup(str, enum.Enum):
    """5 фиксированных групп статусов. Порядок важен — это жизненный цикл заказа."""

    NEW = "new"  # Новые
    IN_WORK = "inWork"  # В работе
    WAIT = "wait"  # Отложенные
    FINISH = "finish"  # Готовые
    CLOSED = "closed"  # Выданные (закрытые)


STATUS_GROUP_TITLES = {
    StatusGroup.NEW: "Новые",
    StatusGroup.IN_WORK: "В работе",
    StatusGroup.WAIT: "Отложенные",
    StatusGroup.FINISH: "Готовые",
    StatusGroup.CLOSED: "Выданные",
}


class OrderType(Base):
    """Тип заказа: Негарантийный, Гарантийный, Ноутбук/ПК… Своя форма и свои правила зарплаты."""

    __tablename__ = "order_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class OrderStatus(Base):
    """Статус заказа внутри группы.

    role_access: {"<role_id>": {"view": true, "set": true, "change": true}}
      view   — видит заказы в этом статусе
      set    — может перевести заказ В этот статус
      change — может перевести заказ ИЗ этого статуса
    Отсутствие роли в словаре = все три права есть.
    """

    __tablename__ = "order_status"

    id: Mapped[int] = mapped_column(primary_key=True)
    group: Mapped[StatusGroup] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(100))
    client_name: Mapped[str | None] = mapped_column(String(200))  # «синоним» — текст для клиента
    color: Mapped[str] = mapped_column(String(9), default="#3E8EF7")
    sort: Mapped[int] = mapped_column(default=0)
    # Нельзя перевести в статус, пока заказ не оплачен полностью
    pay_required: Mapped[bool] = mapped_column(default=False)
    # Комментарий при смене статуса: none | optional | required
    comment_mode: Mapped[str] = mapped_column(String(10), default="none")
    role_access: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(default=True)


class FieldDataType(str, enum.Enum):
    STRING = "string"  # Текст
    TEXT = "text"  # Расширенный текст
    DATE = "date"
    DATETIME = "dateTime"
    BOOLEAN = "boolean"
    NUMBER = "number"
    MONEY = "money"
    ENUM = "enum"  # Значение из списка
    MULTIPLE = "multiple"  # Несколько значений


class FormField(Base):
    """Настройка поля формы для конкретного типа заказа (или типа контрагента).

    key — системное имя: name, phones, brand, model, sn, problem, completeSet, appearance,
          color, password, orderNode, approximatePrice, prepayment, deadline, isUrgent,
          master, manager, howKnow… Для пользовательских полей — custom_<id>.
    place — позиция в сетке формы «ряд.колонка.порядок», например "1.0.2".
    """

    __tablename__ = "form_field"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_type_id: Mapped[int | None] = mapped_column(ForeignKey("order_type.id", ondelete="CASCADE"))
    counteragent_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("counteragent_type.id", ondelete="CASCADE")
    )
    key: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(100))
    group: Mapped[str] = mapped_column(String(20))  # counteragent | device | other | custom
    data_type: Mapped[FieldDataType] = mapped_column(String(10))
    place: Mapped[str] = mapped_column(String(10))
    is_required: Mapped[bool] = mapped_column(default=False)
    is_only_dictionary: Mapped[bool] = mapped_column(default=False)
    default_value: Mapped[object | None] = mapped_column(JSON)  # {"current_user": true} для мастера
    items: Mapped[list[str] | None] = mapped_column(JSON)  # варианты для enum / multiple
    is_visible: Mapped[bool] = mapped_column(default=True)


class Order(Base, TimestampMixin):
    __tablename__ = "order"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # «A15842»
    location_id: Mapped[int] = mapped_column(ForeignKey("location.id"), index=True)
    order_type_id: Mapped[int] = mapped_column(ForeignKey("order_type.id"))
    status_id: Mapped[int] = mapped_column(ForeignKey("order_status.id"), index=True)
    counteragent_id: Mapped[int] = mapped_column(ForeignKey("counteragent.id"), index=True)

    # Устройство
    device_type: Mapped[str | None] = mapped_column(String(100))
    brand: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(200))
    serial: Mapped[str | None] = mapped_column(String(100), index=True)  # SN / IMEI
    problems: Mapped[list[str]] = mapped_column(JSON, default=list)
    complete_set: Mapped[list[str]] = mapped_column(JSON, default=list)
    appearance: Mapped[list[str]] = mapped_column(JSON, default=list)
    color: Mapped[str | None] = mapped_column(String(50))
    device_password: Mapped[str | None] = mapped_column(String(100))

    # Доп. информация
    note: Mapped[str | None] = mapped_column(Text)  # комментарий приёмщика
    approximate_price: Mapped[str | None] = mapped_column(String(100))  # текст: «12000-16000»
    has_prepayment: Mapped[bool] = mapped_column(default=False)
    deadline: Mapped[datetime | None]
    is_urgent: Mapped[bool] = mapped_column(default=False)
    how_know_id: Mapped[int | None] = mapped_column(ForeignKey("how_know.id"))
    verdict: Mapped[str | None] = mapped_column(Text)  # вердикт / рекомендации клиенту
    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)

    # Люди
    master_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("employee.id"))
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))

    # Скидка на весь заказ: процент ИЛИ сумма
    discount_percent: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    discount_sum: Mapped[Decimal] = mapped_column(default=Decimal("0"))

    # Кэш сумм (пересчитывает app.services.orders.recalc_totals)
    total_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # сумма позиций со скидкой
    total_purchase: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # себестоимость
    paid: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # оплачено минус возвраты

    finished_at: Mapped[datetime | None]
    closed_at: Mapped[datetime | None]
    last_action_at: Mapped[datetime] = mapped_column(default=utcnow)
    is_deleted: Mapped[bool] = mapped_column(default=False)

    order_type: Mapped[OrderType] = relationship()
    status: Mapped[OrderStatus] = relationship()
    counteragent: Mapped["Counteragent"] = relationship()  # noqa: F821
    positions: Mapped[list["OrderPosition"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderPosition.id"
    )

    @property
    def debt(self) -> Decimal:
        """Сколько клиент ещё должен по заказу (отрицательное — переплата)."""
        return self.total_price - self.paid


class OrderPosition(Base, TimestampMixin):
    """Работа или запчасть в заказе."""

    __tablename__ = "order_position"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("order.id", ondelete="CASCADE"), index=True)
    nomenclature_id: Mapped[int | None] = mapped_column(ForeignKey("nomenclature.id"))
    is_work: Mapped[bool] = mapped_column(default=False)
    name: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Quantity, default=Decimal("1"))
    price: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # цена за единицу до скидки
    sold_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # цена за единицу после скидки
    purchase_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # себестоимость единицы
    min_price: Mapped[Decimal] = mapped_column(default=Decimal("0"))
    guarantee_days: Mapped[int] = mapped_column(default=0)
    # Исполнитель: мастер для работы, установивший для запчасти
    performer_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    # Склад, с которого списана запчасть
    store_id: Mapped[int | None] = mapped_column(ForeignKey("store.id"))

    order: Mapped[Order] = relationship(back_populates="positions")

    @property
    def total(self) -> Decimal:
        return (self.sold_price * self.quantity).quantize(Decimal("0.01"))

    @property
    def margin(self) -> Decimal:
        return ((self.sold_price - self.purchase_price) * self.quantity).quantize(Decimal("0.01"))


class OrderHistory(Base):
    """Лента событий заказа. type — см. HISTORY_TYPES."""

    __tablename__ = "order_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("order.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    type: Mapped[str] = mapped_column(String(30))
    status_id: Mapped[int | None] = mapped_column(ForeignKey("order_status.id"))
    text: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


HISTORY_TYPES = {
    "created": "Заказ создан",
    "status": "Смена статуса",
    "comment": "Комментарий",
    "info_changed": "Изменена информация о заказе",
    "add_work": "Добавлена работа",
    "add_product": "Добавлена запчасть",
    "change_work": "Изменена работа",
    "change_product": "Изменена запчасть",
    "delete_work": "Удалена работа",
    "delete_product": "Удалена запчасть",
    "payment": "Оплата",
    "refund": "Возврат",
    "change_cash": "Изменение транзакции",
    "delete_cash": "Удаление транзакции",
    "give": "Заказ передан в другую локацию",
    "back": "Заказ возвращён",
    "sms": "Отправлено SMS",
    "telegram": "Отправлено в Telegram",
    "max": "Отправлено в MAX",
    "email": "Отправлено на почту",
    "file": "Прикреплён файл",
    "deleted": "Заказ удалён",
    "restored": "Заказ восстановлен",
}


class OrderFile(Base):
    __tablename__ = "order_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("order.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    filename: Mapped[str] = mapped_column(String(300))
    mimetype: Mapped[str] = mapped_column(String(100))
    size: Mapped[int]
    path: Mapped[str] = mapped_column(String(500))
