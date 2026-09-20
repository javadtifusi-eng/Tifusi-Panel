"""hysteria2 hosts carry their obfuscation password

Iranian networks drop a bare QUIC handshake, so a hysteria2 server is
unreachable from inside Iran unless salamander obfuscation is on. The
password has to reach the client, and the share link is how.

Revision ID: d20fb71a4a8c
Revises: c82db3d3b68e
Create Date: 2026-09-20 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd20fb71a4a8c'
down_revision: Union[str, Sequence[str], None] = 'c82db3d3b68e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('hosts') as batch_op:
        batch_op.add_column(sa.Column('hysteria2_obfs', sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('hosts') as batch_op:
        batch_op.drop_column('hysteria2_obfs')
