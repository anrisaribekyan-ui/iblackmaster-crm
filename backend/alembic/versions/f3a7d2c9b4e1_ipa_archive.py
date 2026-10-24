"""Архив IPA в CRM: поля файла у приложения.

Revision ID: f3a7d2c9b4e1
Revises: e8b1c4d7a9f2
Create Date: 2026-10-24 23:50:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f3a7d2c9b4e1'
down_revision: Union[str, Sequence[str], None] = 'e8b1c4d7a9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        batch.add_column(sa.Column('ipa_size', sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column('ipa_sha256', sa.String(64), nullable=True))
        batch.add_column(sa.Column('ipa_version', sa.String(50), nullable=True))
        batch.add_column(sa.Column('ipa_apple_id', sa.String(200), nullable=True))
        batch.add_column(sa.Column('ipa_uploaded_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('ios_app') as batch:
        for name in ('ipa_uploaded_at', 'ipa_apple_id', 'ipa_version', 'ipa_sha256', 'ipa_size'):
            batch.drop_column(name)
