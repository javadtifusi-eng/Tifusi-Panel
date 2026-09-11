"""add fragment settings to hosts

Revision ID: a1c9f7d2e6b4
Revises: b6d3f0a2c7e1
Create Date: 2026-09-10 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9f7d2e6b4'
down_revision: Union[str, Sequence[str], None] = 'b6d3f0a2c7e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('hosts', sa.Column('fragment_length', sa.String(length=32), nullable=True))
    op.add_column('hosts', sa.Column('fragment_interval', sa.String(length=32), nullable=True))
    op.add_column('hosts', sa.Column('fragment_packets', sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.drop_column('fragment_packets')
        batch_op.drop_column('fragment_interval')
        batch_op.drop_column('fragment_length')
