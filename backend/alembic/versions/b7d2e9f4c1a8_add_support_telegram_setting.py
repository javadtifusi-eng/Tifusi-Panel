"""add support telegram setting

Revision ID: b7d2e9f4c1a8
Revises: e8c1f4a7b2d3
Create Date: 2026-09-13 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d2e9f4c1a8'
down_revision: Union[str, Sequence[str], None] = 'e8c1f4a7b2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.add_column(sa.Column('support_telegram', sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.drop_column('support_telegram')
