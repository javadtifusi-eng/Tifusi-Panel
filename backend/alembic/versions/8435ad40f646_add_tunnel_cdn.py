"""add tunnels.cdn_provider/cdn_host/cdn_port

A tunnel can reach its Iran relay through a CDN (ArvanCloud or
Cloudflare): the foreign side dials the CDN hostname instead of the
relay's address, see app/tunnels/config.py.

Revision ID: 8435ad40f646
Revises: c2da3ada2d4b
Create Date: 2026-09-19 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8435ad40f646'
down_revision: Union[str, Sequence[str], None] = 'c2da3ada2d4b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tunnels') as batch_op:
        batch_op.add_column(sa.Column('cdn_provider', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('cdn_host', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('cdn_port', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tunnels') as batch_op:
        batch_op.drop_column('cdn_port')
        batch_op.drop_column('cdn_host')
        batch_op.drop_column('cdn_provider')
