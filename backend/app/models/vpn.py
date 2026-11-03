"""VPN (iBM, панель Remnawave): клиенты, которым доступ выдан из CRM, и история выдач/продлений."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, TimestampMixin, utcnow


class VpnClient(Base, TimestampMixin):
    __tablename__ = "vpn_client"

    id: Mapped[int] = mapped_column(primary_key=True)
    counteragent_id: Mapped[int | None] = mapped_column(ForeignKey("counteragent.id", ondelete="SET NULL"), index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # 7XXXXXXXXXX
    panel_username: Mapped[str] = mapped_column(String(64), unique=True)
    panel_user_id: Mapped[int | None]
    subscription_url: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None]
    # Закреплённый сотрудник: тот, кто выдал первый доступ; он получает процент с каждого продления
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id", ondelete="SET NULL"), index=True)


class VpnIssue(Base):
    __tablename__ = "vpn_issue"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("vpn_client.id", ondelete="CASCADE"), index=True)
    date: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(10))  # issue | renew
    months: Mapped[int]
    price: Mapped[Decimal] = mapped_column(default=Decimal("0"))  # 0 — выдано бесплатно
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id", ondelete="SET NULL"))  # кто выдал
    transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transaction.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
