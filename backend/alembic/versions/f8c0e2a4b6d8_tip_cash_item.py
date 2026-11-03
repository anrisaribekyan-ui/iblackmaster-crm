"""Статья «Чаевые» (приход).

Revision ID: f8c0e2a4b6d8
Revises: e7a9c1d3f5b7
Create Date: 2026-11-03 16:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f8c0e2a4b6d8'
down_revision: Union[str, Sequence[str], None] = 'e7a9c1d3f5b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.execute(sa.text("SELECT 1 FROM cash_item WHERE type = 'tip'")).first() is None:
        conn.execute(sa.text(
            "INSERT INTO cash_item (name, is_income, type, affects_balance, is_active) "
            "VALUES ('Чаевые', true, 'tip', false, true)"
        ))


def downgrade() -> None:
    pass
