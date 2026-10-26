"""Приложения: отметка «есть ли в российском App Store».

Revision ID: a9c3e5f7b1d2
Revises: f3a7d2c9b4e1
Create Date: 2026-10-26 13:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a9c3e5f7b1d2'
down_revision: Union[str, Sequence[str], None] = 'f3a7d2c9b4e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.add_column(sa.Column('store_ru', sa.String(10), nullable=True))
        batch.add_column(sa.Column('store_checked_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.drop_column('store_checked_at')
        batch.drop_column('store_ru')
