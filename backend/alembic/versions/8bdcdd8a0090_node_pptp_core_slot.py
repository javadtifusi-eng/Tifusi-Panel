"""Node pptp_core_slot: a PPTP core beside IKEv2 and L2TP on the same node.

Revision ID: 8bdcdd8a0090
Revises: c4e8b1f6a2d9
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "8bdcdd8a0090"
down_revision: Union[str, Sequence[str], None] = "c4e8b1f6a2d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.add_column(sa.Column("pptp_core_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_nodes_pptp_core_id_cores", "cores", ["pptp_core_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.drop_constraint("fk_nodes_pptp_core_id_cores", type_="foreignkey")
        batch.drop_column("pptp_core_id")
