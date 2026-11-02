"""Сотрудник: какие подсказки уже показаны.

Revision ID: d6f8b0c2e4a6
Revises: c5e7a9b1d3f4
Create Date: 2026-11-02 19:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd6f8b0c2e4a6'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('employee') as batch:
        batch.add_column(sa.Column('seen_tips', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    with op.batch_alter_table('employee') as batch:
        batch.drop_column('seen_tips')
