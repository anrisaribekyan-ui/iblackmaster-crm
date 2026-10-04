from collections.abc import Generator
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, MetaData, Numeric, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import settings

# Единые имена ограничений — нужно Alembic для предсказуемых миграций.
NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Деньги: всегда Decimal, 2 знака. Никогда не float.
Money = Numeric(14, 2)
# Количество: дробное (для товаров в метрах/литрах), 3 знака.
Quantity = Numeric(14, 3)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)
    type_annotation_map = {
        Decimal: Money,
        datetime: DateTime(timezone=True),
    }


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


def make_engine(url: str):
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    if url in ("sqlite://", "sqlite:///:memory:"):
        from sqlalchemy.pool import StaticPool

        kwargs["poolclass"] = StaticPool  # одна общая in-memory БД (для тестов)
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        # В SQLite внешние ключи по умолчанию выключены.
        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _):
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return engine


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
