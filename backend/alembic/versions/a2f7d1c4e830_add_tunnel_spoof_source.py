"""add tunnels.spoof_source

The "spoof" transport carries the tunnel over source-spoofed UDP so it keeps
working during Iran's national-internet mode. Both sides stamp a single
forged source IP — one the L3 egress filter allow-lists — on their outbound
packets; this column stores it. NULL for every existing tunnel, which uses
another transport and ignores the field.

Revision ID: a2f7d1c4e830
Revises: d8a3f1c6e924
Create Date: 2026-09-24 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2f7d1c4e830'
down_revision: Union[str, Sequence[str], None] = 'd8a3f1c6e924'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tunnels', sa.Column('spoof_source', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('tunnels', 'spoof_source')
