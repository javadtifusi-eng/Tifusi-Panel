"""add resellers

Reseller accounts on admins (limits and allowed protocols) and a per-user
protocol list, see app/resellers.py.

Revision ID: f3c1a7e9b2d4
Revises: d8f3b6a2e7c4
Create Date: 2026-09-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3c1a7e9b2d4'
down_revision: Union[str, Sequence[str], None] = 'd8f3b6a2e7c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('admins') as batch_op:
        batch_op.add_column(sa.Column('is_reseller', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('disabled', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('max_users', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('data_quota', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('protocols', sa.JSON(), nullable=True))
    with op.batch_alter_table('proxy_users') as batch_op:
        batch_op.add_column(sa.Column('protocols', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('proxy_users') as batch_op:
        batch_op.drop_column('protocols')
    with op.batch_alter_table('admins') as batch_op:
        batch_op.drop_column('protocols')
        batch_op.drop_column('data_quota')
        batch_op.drop_column('max_users')
        batch_op.drop_column('disabled')
        batch_op.drop_column('is_reseller')
