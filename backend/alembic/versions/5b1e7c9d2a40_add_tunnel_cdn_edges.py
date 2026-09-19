"""add tunnels.cdn_ips/cdn_front

Pinned clean CDN edge IPs and an optional domain-fronting SNI for a tunnel
through a CDN, see app/tunnels/cdn_scan.py.

Revision ID: 5b1e7c9d2a40
Revises: 8435ad40f646
Create Date: 2026-09-19 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b1e7c9d2a40'
down_revision: Union[str, Sequence[str], None] = '8435ad40f646'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tunnels') as batch_op:
        batch_op.add_column(sa.Column('cdn_ips', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('cdn_front', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tunnels') as batch_op:
        batch_op.drop_column('cdn_front')
        batch_op.drop_column('cdn_ips')
