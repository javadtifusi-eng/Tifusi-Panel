"""add discord webhook setting

Revision ID: 564fbec6b371
Revises: ced8f4a485a2
Create Date: 2026-09-10 14:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '564fbec6b371'
down_revision: Union[str, Sequence[str], None] = 'ced8f4a485a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.add_column(sa.Column('discord_webhook_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.drop_column('discord_webhook_url')
