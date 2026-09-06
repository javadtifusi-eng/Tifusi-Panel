"""give nodes a second, independent ipsec core slot

A node's agent can now run Xray and manage l2tp/ikev2 at the same time
(one physical node serving both), so core_id (xray-only from here on)
and ipsec_core_id are two independent FKs instead of one shared slot.

Revision ID: e5b7c3a19f42
Revises: d4a8f21b6e93
Create Date: 2026-09-06 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b7c3a19f42'
down_revision: Union[str, Sequence[str], None] = 'd4a8f21b6e93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()

    with op.batch_alter_table('nodes', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ipsec_core_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_nodes_ipsec_core_id', 'cores', ['ipsec_core_id'], ['id'])

    # Phase 7 (the previous migration) let core_id point at an l2tp/ikev2
    # Core too, before this dedicated slot existed — move any node already
    # pointing at one of those into ipsec_core_id instead, so an admin who
    # already assigned one doesn't silently lose it.
    rows = connection.execute(sa.text(
        "SELECT nodes.id, cores.core_type FROM nodes JOIN cores ON cores.id = nodes.core_id "
        "WHERE nodes.core_id IS NOT NULL AND cores.core_type IN ('l2tp', 'ikev2')"
    )).fetchall()
    for node_id, _core_type in rows:
        connection.execute(
            sa.text("UPDATE nodes SET ipsec_core_id = core_id, core_id = NULL WHERE id = :id"),
            {"id": node_id},
        )


def downgrade() -> None:
    """Not implemented — same convention as the rest of this history: an
    l2tp/ikev2 ipsec_core_id moved back onto core_id could collide with an
    xray core_id already sitting there, and there's no safe way to pick a
    winner automatically."""
    raise NotImplementedError("downgrade not supported for this migration")
