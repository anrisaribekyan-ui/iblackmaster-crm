"""Идеи сотрудников для владельца: кнопка «Идея для Анри» в любом месте CRM."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin


class Idea(Base, TimestampMixin):
    __tablename__ = "idea"

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    page: Mapped[str | None] = mapped_column(String(300))  # на какой странице CRM была написана идея
    status: Mapped[str] = mapped_column(String(10), default="new", index=True)  # new | done | dismissed
    note: Mapped[str | None] = mapped_column(Text)  # заметка владельца
