"""add tunnels table

The reverse-tunnel relay (backend/tunnel_agent/) that used to be a
separate project — this row is just config source-of-truth + a
reachability check for it, not a managed agent like Node.

Revision ID: f7a1d9c3b2e4
Revises: e5b7c3a19f42
Create Date: 2026-09-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7a1d9c3b2e4'
down_revision: Union[str, Sequence[str], None] = 'e5b7c3a19f42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tunnels',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('iran_address', sa.String(length=255), nullable=False),
        sa.Column('iran_port', sa.Integer(), nullable=False),
        sa.Column('foreign_node_id', sa.Integer(), nullable=True),
        sa.Column('foreign_address', sa.String(length=255), nullable=True),
        sa.Column('transport', sa.String(length=16), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('sni', sa.String(length=255), nullable=True),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('path', sa.String(length=255), nullable=True),
        sa.Column('connection_count', sa.Integer(), nullable=False),
        sa.Column('forwards', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('last_error', sa.String(length=500), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['foreign_node_id'], ['nodes.id']),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('tunnels')
