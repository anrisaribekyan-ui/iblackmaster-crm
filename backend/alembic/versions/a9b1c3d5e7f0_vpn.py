"""VPN: клиенты, выдачи, статья «Оплата VPN».

Revision ID: a9b1c3d5e7f0
Revises: f8c0e2a4b6d8
Create Date: 2026-11-04 01:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a9b1c3d5e7f0'
down_revision: Union[str, Sequence[str], None] = 'f8c0e2a4b6d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'vpn_client',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('counteragent_id', sa.Integer(), sa.ForeignKey('counteragent.id', ondelete='SET NULL')),
        sa.Column('name', sa.String(200)),
        sa.Column('phone', sa.String(20), nullable=False),
        sa.Column('panel_username', sa.String(64), nullable=False),
        sa.Column('panel_user_id', sa.Integer()),
        sa.Column('subscription_url', sa.Text()),
        sa.Column('expires_at', sa.DateTime(timezone=True)),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('employee.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('phone', name='uq_vpn_client_phone'),
        sa.UniqueConstraint('panel_username', name='uq_vpn_client_panel_username'),
    )
    op.create_index('ix_vpn_client_counteragent_id', 'vpn_client', ['counteragent_id'])
    op.create_index('ix_vpn_client_owner_id', 'vpn_client', ['owner_id'])
    op.create_table(
        'vpn_issue',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('client_id', sa.Integer(), sa.ForeignKey('vpn_client.id', ondelete='CASCADE'), nullable=False),
        sa.Column('date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('kind', sa.String(10), nullable=False),
        sa.Column('months', sa.Integer(), nullable=False),
        sa.Column('price', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employee.id', ondelete='SET NULL')),
        sa.Column('transaction_id', sa.Integer(), sa.ForeignKey('transaction.id', ondelete='SET NULL')),
        sa.Column('note', sa.Text()),
    )
    op.create_index('ix_vpn_issue_client_id', 'vpn_issue', ['client_id'])
    op.create_index('ix_vpn_issue_date', 'vpn_issue', ['date'])
    conn = op.get_bind()
    if conn.execute(sa.text("SELECT 1 FROM cash_item WHERE type = 'vpn'")).first() is None:
        conn.execute(sa.text(
            "INSERT INTO cash_item (name, is_income, type, affects_balance, is_active) "
            "VALUES ('Оплата VPN', true, 'vpn', false, true)"
        ))


def downgrade() -> None:
    op.drop_table('vpn_issue')
    op.drop_table('vpn_client')
