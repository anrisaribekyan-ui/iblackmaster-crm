"""Гарантия на позициях заказов, перенесённых из LiveSklad.

В выгрузке LiveSklad гарантии по позициям нет, и все перенесённые позиции получили 0 дней.
Восстанавливаем по правилу: запчасть, совпавшая по названию с товаром справочника, — гарантия товара,
остальное — 90 дней. Трогаем только позиции с гарантией 0 в заказах, созданных до 31.10.2026 по Москве.

Revision ID: e1a5c7d9b3f6
Revises: a9c2e4f6b8d0
Create Date: 2026-10-31 20:00:00
"""
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e1a5c7d9b3f6'
down_revision: Union[str, Sequence[str], None] = 'a9c2e4f6b8d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CUTOVER_UTC = datetime(2026, 10, 30, 21, 0)  # 31.10.2026 00:00 по Москве


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            UPDATE order_position SET guarantee_days = COALESCE(
                (SELECT MAX(n.guarantee_days) FROM nomenclature n
                  WHERE order_position.is_work = :no AND n.guarantee_days > 0
                    AND LOWER(TRIM(n.name)) = LOWER(TRIM(order_position.name))),
                90)
            WHERE guarantee_days = 0
              AND order_id IN (SELECT id FROM "order" WHERE created_at < :cutover)
            """
        ),
        {"no": False, "cutover": CUTOVER_UTC},
    )


def downgrade() -> None:
    pass  # данные не откатываем: вернуть 0 нельзя отличить от гарантии, поставленной вручную
