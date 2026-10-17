"""Сотрудники и роли."""

from datetime import date, datetime

from sqlalchemy import JSON, Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

employee_location = Table(
    "employee_location",
    Base.metadata,
    Column("employee_id", ForeignKey("employee.id", ondelete="CASCADE"), primary_key=True),
    Column("location_id", ForeignKey("location.id", ondelete="CASCADE"), primary_key=True),
)


class Role(Base, TimestampMixin):
    """Роль = набор прав. Права — коды из app.permissions (PERMISSIONS)."""

    __tablename__ = "role"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    home_page: Mapped[str] = mapped_column(String(30), default="orders")  # orders | sales
    # Список кодов прав-флажков, например ["createOrderAccess", "remainAccess"]
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Права-выборы (комбобоксы), например {"orders": "all", "orderSalary": "own"}
    scopes: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    is_system: Mapped[bool] = mapped_column(default=False)


class Employee(Base, TimestampMixin):
    __tablename__ = "employee"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    surname: Mapped[str | None] = mapped_column(String(100))
    patronymic: Mapped[str | None] = mapped_column(String(100))
    short_name: Mapped[str] = mapped_column(String(100))  # как показывать в списках: «Sar. Anri»
    email: Mapped[str] = mapped_column(String(200), unique=True)
    phones: Mapped[str | None] = mapped_column(String(300))
    inn: Mapped[str | None] = mapped_column(String(20))
    position: Mapped[str | None] = mapped_column(String(100))
    birthday: Mapped[date | None]
    password_hash: Mapped[str] = mapped_column(String(200))
    role_id: Mapped[int] = mapped_column(ForeignKey("role.id"))
    is_owner: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(50))
    # Когда последний раз меняли пароль: входы, выданные раньше, перестают действовать
    password_changed_at: Mapped[datetime | None]

    role: Mapped[Role] = relationship()
    locations: Mapped[list["Location"]] = relationship(secondary=employee_location)  # noqa: F821


class EmailCode(Base):
    """Одноразовый код из письма (сброс пароля). Храним только хэш — код из базы не украсть."""

    __tablename__ = "email_code"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(20), default="reset")
    code_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    attempts: Mapped[int] = mapped_column(default=0)
    used_at: Mapped[datetime | None]
