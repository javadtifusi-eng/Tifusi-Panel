"""add ikev2/l2tp host fields, drop ai_api_key setting

Revision ID: c7e2a9f14d8b
Revises: a3f9c1d2e4b7
Create Date: 2026-09-06 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7e2a9f14d8b'
down_revision: Union[str, Sequence[str], None] = 'a3f9c1d2e4b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('hosts', sa.Column('ikev2_psk', sa.String(length=255), nullable=True))
    op.add_column('hosts', sa.Column('l2tp_psk', sa.String(length=255), nullable=True))

    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.drop_column('ai_api_key')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('panel_settings') as batch_op:
        batch_op.add_column(sa.Column('ai_api_key', sa.String(length=255), nullable=True))

    op.drop_column('hosts', 'l2tp_psk')
    op.drop_column('hosts', 'ikev2_psk')
