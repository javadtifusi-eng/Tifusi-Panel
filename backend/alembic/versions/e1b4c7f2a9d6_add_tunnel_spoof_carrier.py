"""add tunnels.spoof_carrier

The "spoof" transport can now carry the tunnel over one of three L4 protocols
— plain source-spoofed UDP (the original behaviour), ICMP Echo, or forged TCP.
The spoofing is identical for all three; the carrier only changes what a filter
or DPI box sees, so a link that throttles UDP may still pass ICMP or fake-TCP.
This column stores the chosen carrier. NULL is treated as "udp", which keeps
every tunnel created before carriers existed on its original behaviour.

Revision ID: e1b4c7f2a9d6
Revises: a2f7d1c4e830
Create Date: 2026-09-25 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1b4c7f2a9d6'
down_revision: Union[str, Sequence[str], None] = 'a2f7d1c4e830'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tunnels', sa.Column('spoof_carrier', sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column('tunnels', 'spoof_carrier')
