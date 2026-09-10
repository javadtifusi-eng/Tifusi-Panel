"""remove WireGuard support (core_type, host protocol, wireguard_peers)

WireGuard here was never more than "the admin runs wg-quick themselves and
pastes a key/subnet into a Core" — no real interface management on the
node, unlike Xray/L2TP/IKEv2. Dropped rather than half-finished.

Revision ID: 27f27f6ee35d
Revises: a1c9e4f6d8b2
Create Date: 2026-09-09 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '27f27f6ee35d'
down_revision: Union[str, Sequence[str], None] = 'a1c9e4f6d8b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()

    # Dependent rows first (SQLite doesn't reliably enforce ON DELETE
    # CASCADE here), then the hosts/cores themselves.
    connection.execute(sa.text(
        "DELETE FROM wireguard_peers WHERE host_id IN "
        "(SELECT id FROM hosts WHERE protocol = 'wireguard')"
    ))
    connection.execute(sa.text(
        "DELETE FROM group_hosts WHERE host_id IN "
        "(SELECT id FROM hosts WHERE protocol = 'wireguard')"
    ))
    connection.execute(sa.text("DELETE FROM hosts WHERE protocol = 'wireguard'"))
    connection.execute(sa.text("DELETE FROM cores WHERE core_type = 'wireguard'"))

    op.drop_table('wireguard_peers')

    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.drop_column('wireguard_public_key')
        batch_op.drop_column('wireguard_private_key')
        batch_op.drop_column('wireguard_port')
        batch_op.drop_column('wireguard_subnet')


def downgrade() -> None:
    """Not implemented — WireGuard hosts/cores/peers are actually deleted
    above, not just relabeled; there's no data to restore."""
    raise NotImplementedError("downgrade not supported for this migration")
