"""add tunnels.spoof_carrier_back

A spoof tunnel can now carry each direction on its own protocol — say forged
TCP from Iran and ICMPv6 back — since a filter often treats the two ways
differently. This column stores the foreign -> Iran carrier when it differs
from spoof_carrier. NULL keeps both directions on spoof_carrier, as before.

Revision ID: b7e2d4a9c1f3
Revises: ca85f3b9f504
Create Date: 2026-09-26 23:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e2d4a9c1f3'
down_revision: Union[str, Sequence[str], None] = 'ca85f3b9f504'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tunnels', sa.Column('spoof_carrier_back', sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column('tunnels', 'spoof_carrier_back')
