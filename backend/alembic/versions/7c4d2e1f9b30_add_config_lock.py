"""add panel_settings.config_lock and proxy_users.config_lock

Config lock: subscriptions that only the Tifusi VPN app can use, see
app/subscription/lock.py.

Revision ID: 7c4d2e1f9b30
Revises: 5b1e7c9d2a40
Create Date: 2026-09-19 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c4d2e1f9b30'
down_revision: Union[str, Sequence[str], None] = '5b1e7c9d2a40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.add_column(sa.Column('config_lock', sa.Boolean(), server_default=sa.false(), nullable=False))
    with op.batch_alter_table('proxy_users') as batch_op:
        batch_op.add_column(sa.Column('config_lock', sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('proxy_users') as batch_op:
        batch_op.drop_column('config_lock')
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.drop_column('config_lock')
