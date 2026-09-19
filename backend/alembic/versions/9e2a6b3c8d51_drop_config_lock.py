"""drop the config lock columns

The config lock was taken out again; this removes the columns
7c4d2e1f9b30 added so panels that ran it end up where they started.

Revision ID: 9e2a6b3c8d51
Revises: 7c4d2e1f9b30
Create Date: 2026-09-19 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e2a6b3c8d51'
down_revision: Union[str, Sequence[str], None] = '7c4d2e1f9b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('proxy_users') as batch_op:
        batch_op.drop_column('config_lock')
    with op.batch_alter_table('panel_settings') as batch_op:
        for name in ('lock_page', 'lock_other', 'lock_app'):
            batch_op.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        for name in ('lock_app', 'lock_other', 'lock_page'):
            batch_op.add_column(sa.Column(name, sa.Boolean(), server_default=sa.false(), nullable=False))
    with op.batch_alter_table('proxy_users') as batch_op:
        batch_op.add_column(sa.Column('config_lock', sa.Boolean(), nullable=True))
