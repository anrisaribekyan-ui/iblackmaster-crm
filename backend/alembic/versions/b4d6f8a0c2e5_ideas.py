"""Идеи сотрудников для владельца (кнопка «Идея для Анри»).

Revision ID: b4d6f8a0c2e5
Revises: a2c4e6f8b0d3
Create Date: 2026-11-01 01:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db

revision: str = 'b4d6f8a0c2e5'
down_revision: Union[str, Sequence[str], None] = 'a2c4e6f8b0d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'idea',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('employee.id'), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('page', sa.String(300)),
        sa.Column('status', sa.String(10), nullable=False, server_default='new'),
        sa.Column('note', sa.Text()),
        sa.Column('created_at', app.db.UTCDateTime(timezone=True), nullable=False),
        sa.Column('updated_at', app.db.UTCDateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_idea_author_id', 'idea', ['author_id'])
    op.create_index('ix_idea_status', 'idea', ['status'])


def downgrade() -> None:
    op.drop_table('idea')
