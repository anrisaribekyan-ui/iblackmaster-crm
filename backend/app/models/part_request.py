"""Заказ запчасти: карточка в «Что купить» (Доска), привязанная к заказу или к пополнению склада."""

from decimal import Decimal

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin


class PartRequest(Base, TimestampMixin):
    __tablename__ = "part_request"

    id: Mapped[int] = mapped_column(primary_key=True)
    doska_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)  # id карточки на Доске
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id", ondelete="SET NULL"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    shop: Mapped[str | None] = mapped_column(String(100))  # где покупаем (Master Mobile, Art-GSM…)
    price: Mapped[Decimal | None]
    # order — под заказ; stock_order — пополнить склад после расхода в заказе; stock_sale — после продажи; other
    purpose: Mapped[str] = mapped_column(String(20), default="order")
    suggested: Mapped[bool] = mapped_column(default=False)  # привязку подсказала система, сотрудник подтвердил
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id", ondelete="SET NULL"))
