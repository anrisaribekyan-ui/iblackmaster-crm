"""Срок хранения файла заказа.

Revision ID: d5f7b9c1e3a5
Revises: c4e6a8b0d2f4
Create Date: 2026-11-18 14:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd5f7b9c1e3a5'
down_revision: Union[str, Sequence[str], None] = 'c4e6a8b0d2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('order_file', sa.Column('expires_at', sa.DateTime(), nullable=True))
    op.create_index('ix_order_file_expires_at', 'order_file', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_order_file_expires_at', table_name='order_file')
    op.drop_column('order_file', 'expires_at')
