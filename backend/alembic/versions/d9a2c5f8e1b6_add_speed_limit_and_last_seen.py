"""add speed_limit_mbps and last_seen to proxy_users

Revision ID: d9a2c5f8e1b6
Revises: c4f7d1e9a3b8
Create Date: 2026-09-11 10:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9a2c5f8e1b6'
down_revision: Union[str, Sequence[str], None] = 'c4f7d1e9a3b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('proxy_users', sa.Column('speed_limit_mbps', sa.BigInteger(), nullable=True))
    op.add_column('proxy_users', sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('proxy_users', schema=None) as batch_op:
        batch_op.drop_column('last_seen')
        batch_op.drop_column('speed_limit_mbps')
