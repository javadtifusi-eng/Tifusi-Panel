"""add app reports

Connection diagnostics posted by the Tifusi VPN Android app to
POST /app/report, readable by admins per user.

Revision ID: d8f3b6a2e7c4
Revises: c3e8a1d5f9b2
Create Date: 2026-09-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8f3b6a2e7c4'
down_revision: Union[str, Sequence[str], None] = 'c3e8a1d5f9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'app_reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('client_ip', sa.String(length=64), nullable=False),
        sa.Column('app_version', sa.String(length=32), nullable=True),
        sa.Column('android_sdk', sa.Integer(), nullable=True),
        sa.Column('device', sa.String(length=100), nullable=True),
        sa.Column('reported_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('event', sa.String(length=32), nullable=False),
        sa.Column('result', sa.String(length=32), nullable=False),
        sa.Column('detail', sa.String(length=500), nullable=True),
        sa.Column('protocol', sa.String(length=32), nullable=True),
        sa.Column('duration_ms', sa.BigInteger(), nullable=True),
        sa.Column('network', sa.String(length=32), nullable=True),
        sa.Column('carrier', sa.String(length=100), nullable=True),
        sa.Column('sim_carrier', sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['proxy_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_app_reports_user_id_received_at', 'app_reports', ['user_id', 'received_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_app_reports_user_id_received_at', table_name='app_reports')
    op.drop_table('app_reports')
