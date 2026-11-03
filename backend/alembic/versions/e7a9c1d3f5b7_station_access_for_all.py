"""Право «добавлять станции и входить в Apple ID» — всем ролям, где можно ставить приложения.

Revision ID: e7a9c1d3f5b7
Revises: d6f8b0c2e4a6
Create Date: 2026-11-03 13:00:00
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e7a9c1d3f5b7'
down_revision: Union[str, Sequence[str], None] = 'd6f8b0c2e4a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACCESS, STATION = 'appInstallAccess', 'appInstallStationAccess'


def upgrade() -> None:
    conn = op.get_bind()
    roles = conn.execute(sa.text('SELECT id, permissions FROM role')).fetchall()
    for role_id, raw in roles:
        permissions = json.loads(raw) if isinstance(raw, str) else list(raw or [])
        if ACCESS in permissions and STATION not in permissions:
            conn.execute(
                sa.text('UPDATE role SET permissions = :p WHERE id = :i').bindparams(sa.bindparam('p', type_=sa.JSON)),
                {'p': [*permissions, STATION], 'i': role_id},
            )


def downgrade() -> None:
    pass
