"""add cores.ikev2_certificate / ikev2_certificate_key

Revision ID: a4c8e21f3b0d
Revises: 967b8cd51f9b
Create Date: 2026-09-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4c8e21f3b0d'
down_revision: Union[str, Sequence[str], None] = '967b8cd51f9b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ikev2_certificate', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ikev2_certificate_key', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.drop_column('ikev2_certificate_key')
        batch_op.drop_column('ikev2_certificate')
