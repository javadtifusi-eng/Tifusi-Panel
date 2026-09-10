"""add ikev2_egress_vless to cores

Revision ID: b6d3f0a2c7e1
Revises: a4c8e21f3b0d
Create Date: 2026-09-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6d3f0a2c7e1'
down_revision: Union[str, Sequence[str], None] = 'a4c8e21f3b0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cores', sa.Column('ikev2_egress_vless', sa.String(length=2048), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.drop_column('ikev2_egress_vless')
