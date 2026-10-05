"""Доски как в Kaiten/Trello: пространство → доски → колонки → карточки.

Например: пространство «Панфа» → доска «Панфа» → колонки «Что нужно в панфу», «Очередь», «Едет»;
карточка — «Дисплей для Redmi Note 12 Pro 4G оригинал / moba 4830».
Порядок колонок и карточек — поле sort (целые числа, пересчитываются при перетаскивании).
"""

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin, utcnow


class BoardSpace(Base, TimestampMixin):
    __tablename__ = "board_space"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id"))
    sort: Mapped[int] = mapped_column(default=0)
    is_archived: Mapped[bool] = mapped_column(default=False)

    boards: Mapped[list["Board"]] = relationship(back_populates="space", order_by="Board.sort")


class Board(Base, TimestampMixin):
    __tablename__ = "board"

    id: Mapped[int] = mapped_column(primary_key=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("board_space.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(default=0)
    is_archived: Mapped[bool] = mapped_column(default=False)

    space: Mapped[BoardSpace] = relationship(back_populates="boards")
    columns: Mapped[list["BoardColumn"]] = relationship(back_populates="board", order_by="BoardColumn.sort")


class BoardColumn(Base):
    __tablename__ = "board_column"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("board.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(default=0)
    is_archived: Mapped[bool] = mapped_column(default=False)

    board: Mapped[Board] = relationship(back_populates="columns")


class Card(Base, TimestampMixin):
    __tablename__ = "card"

    id: Mapped[int] = mapped_column(primary_key=True)
    column_id: Mapped[int] = mapped_column(ForeignKey("board_column.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text)
    text: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(7))  # цветная полоска сверху, #RRGGBB
    sort: Mapped[int] = mapped_column(default=0)
    author_id: Mapped[int] = mapped_column(ForeignKey("employee.id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"))
    deadline: Mapped[datetime | None]
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id"))
    # Чек-лист: [{"text": "Позвонить в Moba", "done": false}]
    checklist: Mapped[list[dict]] = mapped_column(JSON, default=list)
    is_archived: Mapped[bool] = mapped_column(default=False)


class CardComment(Base):
    __tablename__ = "card_comment"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("card.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("employee.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
