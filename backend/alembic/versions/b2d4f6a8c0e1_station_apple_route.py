"""Станция: как она ходит к серверам Apple (напрямую / туннель / прокси).

Revision ID: b2d4f6a8c0e1
Revises: e8b1c4d7a9f2
Create Date: 2026-10-25 00:15:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b2d4f6a8c0e1'
down_revision: Union[str, Sequence[str], None] = 'e8b1c4d7a9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('install_station') as batch:
        batch.add_column(sa.Column('apple_route', sa.String(300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('install_station') as batch:
        batch.drop_column('apple_route')
