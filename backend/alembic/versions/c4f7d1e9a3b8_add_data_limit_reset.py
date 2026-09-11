"""add periodic data_limit reset to proxy_users

Revision ID: c4f7d1e9a3b8
Revises: b2e8a4f1c9d7
Create Date: 2026-09-11 09:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4f7d1e9a3b8'
down_revision: Union[str, Sequence[str], None] = 'b2e8a4f1c9d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('proxy_users', sa.Column('data_limit_reset_days', sa.BigInteger(), nullable=True))
    op.add_column('proxy_users', sa.Column('data_limit_reset_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('proxy_users', schema=None) as batch_op:
        batch_op.drop_column('data_limit_reset_at')
        batch_op.drop_column('data_limit_reset_days')
