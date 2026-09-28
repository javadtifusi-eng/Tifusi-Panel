"""Node usage multiplier: how many bytes of a user's data limit one real byte through this node costs.

Revision ID: a9d4e2c7f1b6
Revises: ef199d60fd5b
Create Date: 2026-09-28 22:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a9d4e2c7f1b6"
down_revision: Union[str, Sequence[str], None] = "ef199d60fd5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("nodes") as batch_op:
        batch_op.add_column(sa.Column("usage_multiplier", sa.Float(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("nodes") as batch_op:
        batch_op.drop_column("usage_multiplier")
