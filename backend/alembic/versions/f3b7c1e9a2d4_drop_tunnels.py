"""drop tunnels table

Revision ID: f3b7c1e9a2d4
Revises: d9a2c5f8e1b6
Create Date: 2026-09-11 11:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3b7c1e9a2d4'
down_revision: Union[str, Sequence[str], None] = 'd9a2c5f8e1b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('tunnels')


def downgrade() -> None:
    op.create_table(
        'tunnels',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('iran_address', sa.String(length=255), nullable=False),
        sa.Column('iran_port', sa.Integer(), nullable=False),
        sa.Column('foreign_node_id', sa.Integer(), sa.ForeignKey('nodes.id'), nullable=True),
        sa.Column('foreign_address', sa.String(length=255), nullable=True),
        sa.Column('transport', sa.Enum('tcp', 'tls', 'ws', 'wss', 'tcpmux', 'wsmux', 'wssmux', 'udp', name='tunneltransport'), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('sni', sa.String(length=255), nullable=True),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('path', sa.String(length=255), nullable=True),
        sa.Column('connection_count', sa.Integer(), nullable=False),
        sa.Column('forwards', sa.JSON(), nullable=False),
        sa.Column('status', sa.Enum('pending', 'connected', 'error', name='tunnelstatus'), nullable=False),
        sa.Column('last_error', sa.String(length=500), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
