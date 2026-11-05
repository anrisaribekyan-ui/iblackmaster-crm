"""Заказ запчастей: привязка карточек «Что купить» к заказам и пополнению склада.

Revision ID: b3d5f7a9c1e2
Revises: a9b1c3d5e7f0
Create Date: 2026-11-05 14:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b3d5f7a9c1e2'
down_revision: Union[str, Sequence[str], None] = 'a9b1c3d5e7f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'part_request',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('doska_id', sa.String(40), nullable=False),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('order.id', ondelete='SET NULL')),
        sa.Column('text', sa.String(500), nullable=False),
        sa.Column('shop', sa.String(100)),
        sa.Column('price', sa.Numeric(14, 2)),
        sa.Column('purpose', sa.String(20), nullable=False, server_default='order'),
        sa.Column('suggested', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employee.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('doska_id', name='uq_part_request_doska_id'),
    )
    op.create_index('ix_part_request_doska_id', 'part_request', ['doska_id'])
    op.create_index('ix_part_request_order_id', 'part_request', ['order_id'])


def downgrade() -> None:
    op.drop_table('part_request')
