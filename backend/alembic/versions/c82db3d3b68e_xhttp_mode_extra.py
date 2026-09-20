"""carry xhttp mode and client extras into share links

An xhttp inbound's `mode` and its `extra` block (xmux above all) mean
nothing to the server and everything to the client, and the share link is
the only way they reach it — which is how a user's traffic gets spread over
several connections instead of one.

Revision ID: c82db3d3b68e
Revises: 9e2a6b3c8d51
Create Date: 2026-09-20 10:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c82db3d3b68e'
down_revision: Union[str, Sequence[str], None] = '9e2a6b3c8d51'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('inbounds') as batch_op:
        batch_op.add_column(sa.Column('xhttp_mode', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('xhttp_extra', sa.String(length=1024), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('inbounds') as batch_op:
        batch_op.drop_column('xhttp_extra')
        batch_op.drop_column('xhttp_mode')
