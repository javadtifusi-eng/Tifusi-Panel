"""drop support telegram setting

The Tifusi VPN app now carries its own support Telegram, so the panel
setting added in b7d2e9f4c1a8 is no longer read anywhere.

Revision ID: c3e8a1d5f9b2
Revises: b7d2e9f4c1a8
Create Date: 2026-09-13 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e8a1d5f9b2'
down_revision: Union[str, Sequence[str], None] = 'b7d2e9f4c1a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.drop_column('support_telegram')


def downgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.add_column(sa.Column('support_telegram', sa.String(length=64), nullable=True))
