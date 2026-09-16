"""add admin avatar

A profile picture per admin, stored as a data: URL (see app/models/admin.py).

Revision ID: b9e4d2a7c1f3
Revises: f3c1a7e9b2d4
Create Date: 2026-09-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9e4d2a7c1f3'
down_revision: Union[str, Sequence[str], None] = 'f3c1a7e9b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('admins') as batch_op:
        batch_op.add_column(sa.Column('avatar', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('admins') as batch_op:
        batch_op.drop_column('avatar')
