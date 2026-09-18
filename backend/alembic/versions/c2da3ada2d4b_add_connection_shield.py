"""add connection shield

Groups of interchangeable Iran relays with automatic failover, see
app/shield/engine.py.

Revision ID: c2da3ada2d4b
Revises: d2f8b4c61a97
Create Date: 2026-09-18 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2da3ada2d4b'
down_revision: Union[str, Sequence[str], None] = 'd2f8b4c61a97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'shield_groups',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('mode', sa.String(length=16), nullable=False),
        sa.Column('dns_record', sa.String(length=255), nullable=True),
        sa.Column('cloudflare_token', sa.String(length=255), nullable=True),
        sa.Column('cloudflare_zone_id', sa.String(length=64), nullable=True),
        sa.Column('fail_threshold', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('active_tunnel_id', sa.Integer(), nullable=True),
        sa.Column('stranded', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('last_error', sa.String(length=500), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'shield_members',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('shield_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tunnel_id', sa.Integer(), sa.ForeignKey('tunnels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('burnt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('fail_streak', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('ok_streak', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_ok', sa.Boolean(), nullable=True),
        sa.Column('last_latency_ms', sa.Integer(), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('tunnel_id', name='uq_shield_members_tunnel_id'),
    )
    op.create_index('ix_shield_members_group_id', 'shield_members', ['group_id'])
    op.create_table(
        'shield_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('shield_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_shield_events_group_id_id', 'shield_events', ['group_id', 'id'])


def downgrade() -> None:
    # Dropping the tables drops their indexes too; MySQL refuses to drop
    # an index on its own while a foreign key still uses it.
    op.drop_table('shield_events')
    op.drop_table('shield_members')
    op.drop_table('shield_groups')
