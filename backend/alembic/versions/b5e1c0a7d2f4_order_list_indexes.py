"""Индексы для быстрого списка заказов на десятках тысяч записей.

Список всегда сортируется по дате создания (новые сверху) и ищет по номеру/серийнику.

Revision ID: b5e1c0a7d2f4
Revises: af23e4dc3ef3
Create Date: 2026-10-17 03:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b5e1c0a7d2f4'
down_revision: Union[str, Sequence[str], None] = 'af23e4dc3ef3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_order_created_at_id', 'order', ['created_at', 'id'])
    op.create_index('ix_order_history_order_id_type', 'order_history', ['order_id', 'type'])


def downgrade() -> None:
    op.drop_index('ix_order_history_order_id_type', table_name='order_history')
    op.drop_index('ix_order_created_at_id', table_name='order')
