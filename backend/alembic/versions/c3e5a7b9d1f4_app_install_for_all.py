"""Раздел «Приложения» — всем ролям: добавляем право appInstallAccess каждой роли.

Станции и вход в Apple ID остаются за отдельным правом appInstallStationAccess.

Revision ID: c3e5a7b9d1f4
Revises: b7d1f3a5c9e2
Create Date: 2026-10-27 12:00:00
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c3e5a7b9d1f4'
down_revision: Union[str, Sequence[str], None] = 'b7d1f3a5c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CODE = "appInstallAccess"


def _load(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return value if isinstance(value, list) else []


def upgrade() -> None:
    conn = op.get_bind()
    role = sa.table("role", sa.column("id", sa.Integer), sa.column("permissions", sa.JSON))
    for role_id, raw in conn.execute(sa.select(role.c.id, role.c.permissions)).all():
        codes = _load(raw)
        if CODE not in codes:
            conn.execute(role.update().where(role.c.id == role_id).values(permissions=[*codes, CODE]))


def downgrade() -> None:
    # Кому право раньше выдали вручную — не отличить, поэтому откат ничего не забирает.
    pass
