"""add ikev2_auth_mode to cores

Revision ID: b2e8a4f1c9d7
Revises: a1c9f7d2e6b4
Create Date: 2026-09-11 00:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2e8a4f1c9d7'
down_revision: Union[str, Sequence[str], None] = 'a1c9f7d2e6b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'cores',
        sa.Column('ikev2_auth_mode', sa.String(length=16), nullable=False, server_default='eap'),
    )


def downgrade() -> None:
    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.drop_column('ikev2_auth_mode')
