"""Admin two-factor login: authenticator-app secret, last used step and recovery code hashes.

Revision ID: c4e8b1f6a2d9
Revises: a9d4e2c7f1b6
Create Date: 2026-09-28 22:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c4e8b1f6a2d9"
down_revision: Union[str, Sequence[str], None] = "a9d4e2c7f1b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("admins") as batch_op:
        batch_op.add_column(sa.Column("totp_secret", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("totp_recovery_hashes", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("admins") as batch_op:
        batch_op.drop_column("totp_recovery_hashes")
        batch_op.drop_column("totp_last_step")
        batch_op.drop_column("totp_enabled")
        batch_op.drop_column("totp_secret")
