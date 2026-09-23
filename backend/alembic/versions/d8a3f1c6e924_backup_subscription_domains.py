"""Backup subscription domains on panel_settings

Revision ID: d8a3f1c6e924
Revises: c4d19e7a2b60
"""

import sqlalchemy as sa
from alembic import op

revision = "d8a3f1c6e924"
down_revision = "c4d19e7a2b60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("panel_settings", sa.Column("backup_domains", sa.JSON(), nullable=True))
    op.add_column(
        "panel_settings",
        sa.Column("backup_auto_failover", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("panel_settings", "backup_auto_failover")
    op.drop_column("panel_settings", "backup_domains")
