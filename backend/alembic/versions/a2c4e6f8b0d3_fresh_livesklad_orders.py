"""Заказы A15977–A15980, созданные в LiveSklad 31.10.2026 после выгрузки.

Добавляем только отсутствующие номера (см. app/importers/livesklad_fresh.py).

Revision ID: a2c4e6f8b0d3
Revises: f7b2d4e6a8c1
Create Date: 2026-10-31 22:30:00
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy.orm import Session

revision: str = 'a2c4e6f8b0d3'
down_revision: Union[str, Sequence[str], None] = 'f7b2d4e6a8c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from app.importers.livesklad_fresh import add_missing

    session = Session(bind=op.get_bind())
    add_missing(session)
    session.flush()


def downgrade() -> None:
    pass
