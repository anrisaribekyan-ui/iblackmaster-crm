"""Установка iOS-приложений через станции (пишет и меняет только Claude).

Станция — компьютер в точке, к которому по USB подключают айфоны. На нём работает
помощник (station-agent): он ходит в CRM по токену станции, сообщает подключённые телефоны,
забирает задачи и выполняет их (ipatool + pymobiledevice3).

IosApp — библиотека: приложения с App Store ID (adamId), найденные на донорах или в покупках Apple ID.
AppInstallJob — одна задача станции: скан донора, список покупок, вход в Apple ID, установка.
"""

from datetime import datetime

from sqlalchemy import JSON, BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin, utcnow


class InstallStation(Base, TimestampMixin):
    __tablename__ = "install_station"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("location.id", ondelete="SET NULL"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 токена; сам токен не храним
    is_active: Mapped[bool] = mapped_column(default=True)
    last_seen_at: Mapped[datetime | None]
    os: Mapped[str | None] = mapped_column(String(20))
    agent_version: Mapped[str | None] = mapped_column(String(20))
    devices: Mapped[list[dict]] = mapped_column(JSON, default=list)  # что сейчас подключено по USB
    apple_id: Mapped[str | None] = mapped_column(String(200))  # под каким Apple ID вошёл помощник
    apple_auth: Mapped[str] = mapped_column(String(10), default="unknown")  # ok | needed | unknown
    apple_route: Mapped[str | None] = mapped_column(String(300))  # как станция ходит к Apple: напрямую / туннель / прокси


class IosApp(Base, TimestampMixin):
    __tablename__ = "ios_app"

    id: Mapped[int] = mapped_column(primary_key=True)
    adam_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    bundle_id: Mapped[str] = mapped_column(String(200), index=True)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[str | None] = mapped_column(String(50))
    version_id: Mapped[int | None] = mapped_column(BigInteger)  # softwareVersionExternalIdentifier
    source: Mapped[str] = mapped_column(String(10), default="scan")  # scan | purchases | upload
    is_active: Mapped[bool] = mapped_column(default=True)
    # Архив CRM: сам файл IPA лежит в uploads/ipa/<id>.ipa. Ставится без донора и без Apple,
    # но запустится только на телефоне, где в App Store вход в тот же Apple ID (ipa_apple_id).
    ipa_size: Mapped[int | None] = mapped_column(BigInteger)
    ipa_sha256: Mapped[str | None] = mapped_column(String(64))
    ipa_version: Mapped[str | None] = mapped_column(String(50))
    ipa_apple_id: Mapped[str | None] = mapped_column(String(200))
    ipa_uploaded_at: Mapped[datetime | None]


class JobKind:
    SCAN = "scan"  # прочитать приложения с подключённого донора
    PURCHASES = "purchases"  # список покупок Apple ID
    LOGIN = "login"  # вход в Apple ID на станции
    INSTALL = "install"  # скачать IPA и поставить на телефон

    ALL = (SCAN, PURCHASES, LOGIN, INSTALL)


class JobState:
    QUEUED = "queued"
    RUNNING = "running"
    NEED_CODE = "need_code"  # Apple прислал код, ждём его от сотрудника
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"

    OPEN = (QUEUED, RUNNING, NEED_CODE)


class AppInstallJob(Base):
    __tablename__ = "app_install_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("install_station.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    app_id: Mapped[int | None] = mapped_column(ForeignKey("ios_app.id", ondelete="SET NULL"))
    target_udid: Mapped[str | None] = mapped_column(String(64))
    target_name: Mapped[str | None] = mapped_column(String(100))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("order.id", ondelete="SET NULL"))
    state: Mapped[str] = mapped_column(String(10), default=JobState.QUEUED, index=True)
    progress: Mapped[int] = mapped_column(default=0)
    message: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(30))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    # Пароль Apple ID или код 2FA. Отдаётся помощнику один раз и сразу стирается.
    secret: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id", ondelete="SET NULL"))

    station: Mapped[InstallStation] = relationship()
    app: Mapped[IosApp | None] = relationship()
