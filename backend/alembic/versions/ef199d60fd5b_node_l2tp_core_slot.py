"""Node l2tp_core_slot: an L2TP core beside the IKEv2 one on the same node.

Revision ID: ef199d60fd5b
Revises: b7e2d4a9c1f3
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "ef199d60fd5b"
down_revision: Union[str, Sequence[str], None] = "b7e2d4a9c1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.add_column(sa.Column("l2tp_core_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_nodes_l2tp_core_id_cores", "cores", ["l2tp_core_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.drop_constraint("fk_nodes_l2tp_core_id_cores", type_="foreignkey")
        batch.drop_column("l2tp_core_id")
