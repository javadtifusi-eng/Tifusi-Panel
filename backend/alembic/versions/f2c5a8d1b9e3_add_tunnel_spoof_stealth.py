"""add tunnels.spoof_stealth

Advanced stealth for the spoof transport: each side randomises its outbound
packets (TTL, DSCP, source port) so the flow has no fixed fingerprint, and
accepts only inbound packets whose forged source is the configured
spoof_source. NULL/false keeps the plain behaviour for existing tunnels.

Revision ID: f2c5a8d1b9e3
Revises: e1b4c7f2a9d6
Create Date: 2026-09-25 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2c5a8d1b9e3'
down_revision: Union[str, Sequence[str], None] = 'e1b4c7f2a9d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tunnels', sa.Column('spoof_stealth', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('tunnels', 'spoof_stealth')
