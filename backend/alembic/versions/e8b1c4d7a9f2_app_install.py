"""Установка iOS-приложений: станции, библиотека приложений, задачи.

Revision ID: e8b1c4d7a9f2
Revises: d4f7a2b9c1e3
Create Date: 2026-10-22 23:50:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8b1c4d7a9f2'
down_revision: Union[str, Sequence[str], None] = 'd4f7a2b9c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'install_station',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('location.id', ondelete='SET NULL'), nullable=True),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('os', sa.String(20), nullable=True),
        sa.Column('agent_version', sa.String(20), nullable=True),
        sa.Column('devices', sa.JSON(), nullable=False),
        sa.Column('apple_id', sa.String(200), nullable=True),
        sa.Column('apple_auth', sa.String(10), nullable=False, server_default='unknown'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'ios_app',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('adam_id', sa.BigInteger(), nullable=False, unique=True),
        sa.Column('bundle_id', sa.String(200), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('version', sa.String(50), nullable=True),
        sa.Column('version_id', sa.BigInteger(), nullable=True),
        sa.Column('source', sa.String(10), nullable=False, server_default='scan'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_ios_app_bundle_id', 'ios_app', ['bundle_id'])
    op.create_table(
        'app_install_job',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('station_id', sa.Integer(), sa.ForeignKey('install_station.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(10), nullable=False),
        sa.Column('app_id', sa.Integer(), sa.ForeignKey('ios_app.id', ondelete='SET NULL'), nullable=True),
        sa.Column('target_udid', sa.String(64), nullable=True),
        sa.Column('target_name', sa.String(100), nullable=True),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('order.id', ondelete='SET NULL'), nullable=True),
        sa.Column('state', sa.String(10), nullable=False, server_default='queued'),
        sa.Column('progress', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('error_code', sa.String(30), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('secret', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('employee.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_app_install_job_station_id', 'app_install_job', ['station_id'])
    op.create_index('ix_app_install_job_state', 'app_install_job', ['state'])
    op.create_index('ix_app_install_job_created_at', 'app_install_job', ['created_at'])


def downgrade() -> None:
    op.drop_table('app_install_job')
    op.drop_index('ix_ios_app_bundle_id', 'ios_app')
    op.drop_table('ios_app')
    op.drop_table('install_station')
