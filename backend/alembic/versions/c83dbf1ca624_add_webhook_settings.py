"""add webhook settings

Revision ID: c83dbf1ca624
Revises: 16cf6494fc68
Create Date: 2026-09-09 22:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c83dbf1ca624'
down_revision: Union[str, Sequence[str], None] = '16cf6494fc68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.add_column(sa.Column('webhook_url', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('webhook_secret', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.drop_column('webhook_secret')
        batch_op.drop_column('webhook_url')
