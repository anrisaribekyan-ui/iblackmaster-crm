"""Свой процент зарплаты на позицию заказа.

Revision ID: c4e6a8b0d2f4
Revises: b3d5f7a9c1e2
Create Date: 2026-11-06 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4e6a8b0d2f4'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('order_position', sa.Column('salary_percent', sa.Numeric(), nullable=True))


def downgrade() -> None:
    op.drop_column('order_position', 'salary_percent')
