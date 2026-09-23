"""WireGuard core: server key, port and MTU on cores, a fourth slot on nodes

Revision ID: c4d19e7a2b60
Revises: b5e08d2a1f37
"""

import sqlalchemy as sa
from alembic import op

revision = "c4d19e7a2b60"
down_revision = "b5e08d2a1f37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cores", sa.Column("wireguard_port", sa.Integer(), nullable=True))
    op.add_column("cores", sa.Column("wireguard_mtu", sa.Integer(), nullable=True))
    op.add_column("cores", sa.Column("wireguard_private_key", sa.String(length=64), nullable=True))
    with op.batch_alter_table("nodes") as batch:
        batch.add_column(sa.Column("wireguard_core_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_nodes_wireguard_core_id", "cores", ["wireguard_core_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.drop_constraint("fk_nodes_wireguard_core_id", type_="foreignkey")
        batch.drop_column("wireguard_core_id")
    op.drop_column("cores", "wireguard_private_key")
    op.drop_column("cores", "wireguard_mtu")
    op.drop_column("cores", "wireguard_port")
