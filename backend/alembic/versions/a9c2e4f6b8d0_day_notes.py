"""Заметки «что сегодня было».

Revision ID: a9c2e4f6b8d0
Revises: c3e5a7b9d1f4
Create Date: 2026-10-30 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a9c2e4f6b8d0'
down_revision: Union[str, Sequence[str], None] = 'c3e5a7b9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'day_note',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('location.id'), nullable=True),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('employee.id'), nullable=False),
        sa.Column('note_date', sa.Date(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('items', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('analyzed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('analyzed_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_day_note_location_id', 'day_note', ['location_id'])
    op.create_index('ix_day_note_author_id', 'day_note', ['author_id'])
    op.create_index('ix_day_note_note_date', 'day_note', ['note_date'])


def downgrade() -> None:
    op.drop_table('day_note')
