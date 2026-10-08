"""Уведомления клиентам (SMS через Android-шлюз с рабочей симкой). Пишет и меняет только Claude.

NotificationTemplate — текст на статус заказа (переменные см. services/notifications.py).
Notification — одно сообщение: очередь → отправка шлюзом → доставлено/ошибка. Это и есть журнал.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin, utcnow


class NotificationTemplate(Base, TimestampMixin):
    __tablename__ = "notification_template"

    id: Mapped[int] = mapped_column(primary_key=True)
    status_id: Mapped[int] = mapped_column(ForeignKey("order_status.id", ondelete="CASCADE"), unique=True)
    text: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)


class NotificationState:
    QUEUED = "queued"  # ждёт отправки
    SENDING = "sending"  # взято процессом в отправку
    SENT = "sent"  # передано телефону-шлюзу
    DELIVERED = "delivered"  # оператор подтвердил доставку
    FAILED = "failed"  # не ушло после всех попыток
    CANCELLED = "cancelled"  # заменено более свежим сообщением или отменено


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id", ondelete="SET NULL"), index=True)
    counteragent_id: Mapped[int | None] = mapped_column(ForeignKey("counteragent.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(20), default="status")  # status | manual | test
    channel: Mapped[str] = mapped_column(String(10), default="sms")
    phone: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(12), default=NotificationState.QUEUED, index=True)
    attempts: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(String(64))
    sent_at: Mapped[datetime | None]
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
