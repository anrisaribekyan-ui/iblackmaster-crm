"""order agreed price

Revision ID: a3c9e5f1b7d2
Revises: d4f7a2b9c1e3
Create Date: 2026-10-20 12:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3c9e5f1b7d2'
down_revision: Union[str, Sequence[str], None] = 'd4f7a2b9c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('order') as batch:
        batch.add_column(sa.Column('is_price_agreed', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('price_terms', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('order') as batch:
        batch.drop_column('price_terms')
        batch.drop_column('is_price_agreed')
