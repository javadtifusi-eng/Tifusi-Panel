"""drop tunnel hamrang_quic (Hamrang transport removed)

Revision ID: ca85f3b9f504
Revises: c3d6e9f2a1b4
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

revision = "ca85f3b9f504"
down_revision = "c3d6e9f2a1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM shield_members WHERE tunnel_id IN (SELECT id FROM tunnels WHERE transport = 'hamrang')")
    op.execute("DELETE FROM tunnels WHERE transport = 'hamrang'")
    with op.batch_alter_table("tunnels") as batch:
        batch.drop_column("hamrang_quic")


def downgrade() -> None:
    with op.batch_alter_table("tunnels") as batch:
        batch.add_column(sa.Column("hamrang_quic", sa.Boolean(), nullable=True))
