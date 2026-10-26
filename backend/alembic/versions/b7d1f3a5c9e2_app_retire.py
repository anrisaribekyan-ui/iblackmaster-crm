"""Приложения: «убрать» с причиной (не работает / не нужно).

Revision ID: b7d1f3a5c9e2
Revises: a9c3e5f7b1d2
Create Date: 2026-10-26 13:50:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b7d1f3a5c9e2'
down_revision: Union[str, Sequence[str], None] = 'a9c3e5f7b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.add_column(sa.Column('retired_reason', sa.String(10), nullable=True))
        batch.add_column(sa.Column('retired_note', sa.String(500), nullable=True))
        batch.add_column(sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('retired_by_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_ios_app_retired_by', 'employee', ['retired_by_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.drop_constraint('fk_ios_app_retired_by', type_='foreignkey')
        for name in ('retired_by_id', 'retired_at', 'retired_note', 'retired_reason'):
            batch.drop_column(name)
