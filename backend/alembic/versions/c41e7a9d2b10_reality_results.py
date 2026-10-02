"""reality_results: REALITY names measured from inside Iran

Revision ID: c41e7a9d2b10
Revises: 8bdcdd8a0090
Create Date: 2026-10-02 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c41e7a9d2b10'
down_revision: Union[str, Sequence[str], None] = '8bdcdd8a0090'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'reality_results',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('run_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('run_id', sa.String(length=32), nullable=False),
        sa.Column('node_id', sa.Integer(), nullable=True),
        sa.Column('round', sa.Integer(), nullable=False),
        sa.Column('client_ip', sa.String(length=64), nullable=True),
        sa.Column('operator', sa.String(length=64), nullable=True),
        sa.Column('sni', sa.String(length=255), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=True),
        sa.Column('label', sa.String(length=64), nullable=True),
        sa.Column('port', sa.Integer(), nullable=False),
        sa.Column('fingerprint', sa.String(length=32), nullable=False),
        sa.Column('ok', sa.Boolean(), nullable=False),
        sa.Column('delay_ms', sa.Integer(), nullable=True),
        sa.Column('up_bps', sa.BigInteger(), nullable=True),
        sa.Column('down_bps', sa.BigInteger(), nullable=True),
        sa.Column('error', sa.String(length=200), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_reality_results_run_at', 'reality_results', ['run_at'])


def downgrade() -> None:
    op.drop_index('ix_reality_results_run_at', table_name='reality_results')
    op.drop_table('reality_results')
