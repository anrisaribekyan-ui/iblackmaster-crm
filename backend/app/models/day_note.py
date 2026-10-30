"""Заметка «что сегодня было»: мастер пишет день в свободной форме, ИИ раскладывает на продажи и выдачи."""

from datetime import date, datetime

from sqlalchemy import JSON, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin


class DayNote(Base, TimestampMixin):
    __tablename__ = "day_note"

    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), index=True)
    note_date: Mapped[date] = mapped_column(index=True)
    text: Mapped[str] = mapped_column(Text, default="")
    # Результат разбора: [{kind, text, title, amount, method, person, candidates, status, ref}]
    items: Mapped[list] = mapped_column(JSON, default=list)
    analyzed_at: Mapped[datetime | None]
    analyzed_by: Mapped[str | None] = mapped_column(default=None)  # «ai» | «rules»
