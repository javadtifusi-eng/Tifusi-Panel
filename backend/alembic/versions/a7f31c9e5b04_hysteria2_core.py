"""Hysteria2 becomes a Core, so the panel pushes its config like Xray's

A hysteria2 Host used to carry the port and obfuscation password itself, and
nothing pushed them anywhere: the server was a YAML file someone edited by hand
on one machine. The panel's idea of it and the file actually running could drift
apart with no error — change the obfuscation password in the panel and every
link silently stops connecting. The fields move onto a Core, nodes get a third
core slot for it, and sync_node pushes it.

Existing hysteria2 Host rows keep their own columns: this migration adds and
never removes, so a panel that had a hand-run server keeps working until its
admin builds the Core. app/models/host.py reads the Core first and falls back.

Revision ID: a7f31c9e5b04
Revises: d20fb71a4a8c
"""

import sqlalchemy as sa
from alembic import op

revision = "a7f31c9e5b04"
down_revision = "d20fb71a4a8c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cores") as batch_op:
        batch_op.add_column(sa.Column("hysteria2_port", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("hysteria2_obfs", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("hysteria2_rate_mbps", sa.Integer(), nullable=True))
    with op.batch_alter_table("nodes") as batch_op:
        batch_op.add_column(sa.Column("hysteria_core_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_nodes_hysteria_core", "cores", ["hysteria_core_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("nodes") as batch_op:
        batch_op.drop_constraint("fk_nodes_hysteria_core", type_="foreignkey")
        batch_op.drop_column("hysteria_core_id")
    with op.batch_alter_table("cores") as batch_op:
        batch_op.drop_column("hysteria2_rate_mbps")
        batch_op.drop_column("hysteria2_obfs")
        batch_op.drop_column("hysteria2_port")
