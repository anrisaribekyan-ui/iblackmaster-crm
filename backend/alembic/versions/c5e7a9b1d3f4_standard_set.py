"""Приложения: стандартный набор для нового телефона.

Revision ID: c5e7a9b1d3f4
Revises: b4d6f8a0c2e5
Create Date: 2026-11-01 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c5e7a9b1d3f4'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c2e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.add_column(sa.Column('in_standard_set', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.drop_column('in_standard_set')
