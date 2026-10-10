"""Касса «Перевод …» — одна общая на все точки (как в LiveSklad), а не копия в каждой точке.

При первом переносе настроек общая касса превратилась в три одинаковые — по одной в каждой точке.
Миграция сливает их в одну общую: остатки складываются, все операции переносятся на оставшуюся кассу.
Заодно операциям через общие кассы (терминал, перевод) проставляется точка из заказа или чека —
иначе отчёты по точкам не видели эти оплаты.

Revision ID: 7c2f1a9d4e10
Revises: 1ed55ae52dd7
Create Date: 2026-10-11 00:10:00
"""
from collections import defaultdict
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '7c2f1a9d4e10'
down_revision: Union[str, Sequence[str], None] = '1ed55ae52dd7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, name, location_id, cash_balance, bank_balance FROM cash_register "
        "WHERE location_id IS NOT NULL AND name LIKE 'Перевод%' ORDER BY id"
    )).fetchall()
    groups: dict[str, list] = defaultdict(list)
    for row in rows:
        groups[row.name.strip()].append(row)

    for name, regs in groups.items():
        if len({r.location_id for r in regs}) < 2:
            continue  # касса перевода только в одной точке — это её собственная, не трогаем
        keep, others = regs[0], regs[1:]
        cash = sum((r.cash_balance or 0) for r in regs)
        bank = sum((r.bank_balance or 0) for r in regs)
        other_ids = [r.id for r in others]
        for oid in other_ids:
            conn.execute(sa.text("UPDATE \"transaction\" SET cash_register_id = :keep WHERE cash_register_id = :old"),
                         {"keep": keep.id, "old": oid})
            conn.execute(sa.text("DELETE FROM cash_register WHERE id = :old"), {"old": oid})
        conn.execute(
            sa.text("UPDATE cash_register SET location_id = NULL, is_default = :f, cash_balance = :c, bank_balance = :b WHERE id = :id"),
            {"f": False, "c": cash, "b": bank, "id": keep.id},
        )

    # Точка у операций общих касс — из заказа, затем из чека
    conn.execute(sa.text(
        'UPDATE "transaction" SET location_id = (SELECT o.location_id FROM "order" o WHERE o.id = "transaction".order_id) '
        'WHERE location_id IS NULL AND order_id IS NOT NULL'
    ))
    conn.execute(sa.text(
        'UPDATE "transaction" SET location_id = (SELECT s.location_id FROM sale s WHERE s.id = "transaction".sale_id) '
        'WHERE location_id IS NULL AND sale_id IS NOT NULL'
    ))


def downgrade() -> None:
    # Обратно на три кассы не разделяем: какая операция к какой точке относилась, по общей кассе уже не восстановить.
    pass
