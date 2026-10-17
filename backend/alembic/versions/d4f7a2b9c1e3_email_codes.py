"""Коды из писем (сброс пароля) и момент последней смены пароля.

Revision ID: d4f7a2b9c1e3
Revises: b5e1c0a7d2f4
Create Date: 2026-10-17 10:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd4f7a2b9c1e3'
down_revision: Union[str, Sequence[str], None] = 'b5e1c0a7d2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('employee', sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        'email_code',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employee.id', ondelete='CASCADE'), nullable=False),
        sa.Column('purpose', sa.String(20), nullable=False),
        sa.Column('code_hash', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_email_code_employee_id', 'email_code', ['employee_id'])


def downgrade() -> None:
    op.drop_index('ix_email_code_employee_id', 'email_code')
    op.drop_table('email_code')
    op.drop_column('employee', 'password_changed_at')
