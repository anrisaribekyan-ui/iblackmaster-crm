"""Задачи сотрудников (как «Задачи» в LiveSklad). Можно привязать к заказу."""

from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin


class Task(Base, TimestampMixin):
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    text: Mapped[str | None] = mapped_column(Text)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("employee.id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"), index=True)
    deadline: Mapped[datetime | None]
    is_done: Mapped[bool] = mapped_column(default=False)
    done_at: Mapped[datetime | None]
    done_by_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    is_deleted: Mapped[bool] = mapped_column(default=False)
