"""Зарплата Анри из LiveSklad: пересчёт по новым правилам, которые владелец поменял 31.10.2026.

Помесячные итоги, перенесённые раньше, в LiveSklad пересчитались. Находим события переноса именно с прежними суммами
(октябрь 145 740, сентябрь 82 718, август 141 600, июль 114 580, июнь 63 510) и заменяем их новыми; за май добавляем 700.
Ничего другого не трогаем: событие с другой суммой (например, поправленное вручную) остаётся как есть.

Revision ID: f7b2d4e6a8c1
Revises: e1a5c7d9b3f6
Create Date: 2026-10-31 22:00:00
"""
import json
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f7b2d4e6a8c1'
down_revision: Union[str, Sequence[str], None] = 'e1a5c7d9b3f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOTE = "LiveSklad: итог за месяц"
# (месяц, год): (было, стало)
FIXES = {
    (10, 2026): (145740, 72527),
    (9, 2026): (82718, 48601),
    (8, 2026): (141600, 89630),
    (7, 2026): (114580, 83893),
    (6, 2026): (63510, 50266),
}
MAY_2026 = 700


def upgrade() -> None:
    bind = op.get_bind()
    owners = set()
    for (month, year), (old, new) in FIXES.items():
        note = f"{NOTE} {month:02}.{year}"
        rows = bind.execute(
            sa.text("SELECT id, employee_id, amount, details FROM salary_event WHERE note = :n AND kind = 'workOrder'"),
            {"n": note},
        ).fetchall()
        for row in rows:
            if int(row.amount) != old:
                continue
            details = row.details if isinstance(row.details, dict) else json.loads(row.details or "{}")
            details["total"] = str(new)
            bind.execute(
                sa.text("UPDATE salary_event SET amount = :a, details = :d WHERE id = :id"),
                {"a": new, "d": json.dumps(details), "id": row.id},
            )
            owners.add(row.employee_id)
    if len(owners) == 1:  # дописываем май только если нашли того самого сотрудника
        employee_id = owners.pop()
        note = f"{NOTE} 05.2026"
        exists = bind.execute(sa.text("SELECT 1 FROM salary_event WHERE employee_id = :e AND note = :n"),
                              {"e": employee_id, "n": note}).first()
        if not exists:
            bind.execute(
                sa.text(
                    "INSERT INTO salary_event (employee_id, kind, date, amount, details, is_manual, note) "
                    "VALUES (:e, 'workOrder', :d, :a, :det, :m, :n)"
                ),
                {"e": employee_id, "d": datetime(2026, 5, 31, 9, 0), "a": MAY_2026,
                 "det": json.dumps({"source": "livesklad", "total": str(MAY_2026)}), "m": True, "n": note},
            )


def downgrade() -> None:
    pass
