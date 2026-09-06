"""core types for wireguard/l2tp/ikev2 (shared fields move onto the Core)

Revision ID: d4a8f21b6e93
Revises: c7e2a9f14d8b
Create Date: 2026-09-06 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a8f21b6e93'
down_revision: Union[str, Sequence[str], None] = 'c7e2a9f14d8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()

    op.add_column('cores', sa.Column('core_type', sa.String(length=16), nullable=True))
    op.add_column('cores', sa.Column('wireguard_public_key', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('wireguard_private_key', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('wireguard_port', sa.Integer(), nullable=True))
    op.add_column('cores', sa.Column('wireguard_subnet', sa.String(length=32), nullable=True))
    op.add_column('cores', sa.Column('l2tp_psk', sa.String(length=255), nullable=True))
    op.add_column('cores', sa.Column('ikev2_psk', sa.String(length=255), nullable=True))
    op.add_column('cores', sa.Column('ikev2_remote_id', sa.String(length=255), nullable=True))

    # Every core that existed before this migration was, by definition, an
    # Xray core — this is the only type that has ever existed.
    connection.execute(sa.text("UPDATE cores SET core_type = 'xray' WHERE core_type IS NULL"))

    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.alter_column('core_type', existing_type=sa.String(length=16), nullable=False)
        batch_op.alter_column('config', existing_type=sa.JSON(), nullable=True)

    # Any existing wireguard/l2tp/ikev2 Host still carries its own
    # keys/PSK directly (the pre-this-session design) — spin up one new
    # Core per such Host to hold those fields now, instead of losing them.
    old_hosts = connection.execute(sa.text(
        "SELECT id, remark, protocol, wireguard_public_key, wireguard_private_key, "
        "wireguard_subnet, wireguard_port, l2tp_psk, ikev2_psk "
        "FROM hosts WHERE protocol IN ('wireguard', 'l2tp', 'ikev2')"
    )).fetchall()

    existing_names = {
        row[0] for row in connection.execute(sa.text("SELECT name FROM cores")).fetchall()
    }

    def _unique_name(base: str) -> str:
        name = base
        n = 2
        while name in existing_names:
            name = f"{base} ({n})"
            n += 1
        existing_names.add(name)
        return name

    host_core_id: dict[int, int] = {}
    for host_id, remark, protocol, wg_pub, wg_priv, wg_subnet, wg_port, l2tp_psk, ikev2_psk in old_hosts:
        name = _unique_name(f"{remark} ({protocol})")
        result = connection.execute(
            sa.text(
                "INSERT INTO cores (name, core_type, wireguard_public_key, wireguard_private_key, "
                "wireguard_subnet, wireguard_port, l2tp_psk, ikev2_psk, created_at) "
                "VALUES (:name, :core_type, :wg_pub, :wg_priv, :wg_subnet, :wg_port, :l2tp_psk, :ikev2_psk, "
                "CURRENT_TIMESTAMP)"
            ),
            {
                "name": name,
                "core_type": protocol,
                "wg_pub": wg_pub,
                "wg_priv": wg_priv,
                "wg_subnet": wg_subnet,
                "wg_port": wg_port,
                "l2tp_psk": l2tp_psk,
                "ikev2_psk": ikev2_psk,
            },
        )
        host_core_id[host_id] = result.lastrowid

    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('core_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_hosts_core_id', 'cores', ['core_id'], ['id'])

    for host_id, core_id in host_core_id.items():
        connection.execute(
            sa.text("UPDATE hosts SET core_id = :core_id WHERE id = :id"),
            {"core_id": core_id, "id": host_id},
        )

    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.drop_column('wireguard_public_key')
        batch_op.drop_column('wireguard_private_key')
        batch_op.drop_column('wireguard_subnet')
        batch_op.drop_column('wireguard_port')
        batch_op.drop_column('l2tp_psk')
        batch_op.drop_column('ikev2_psk')


def downgrade() -> None:
    """Not implemented — same as the previous Core-redesign migrations in
    this history, moving shared fields back onto every Host that shares a
    Core would require picking one Host to "win" per field, silently
    losing data for the rest."""
    raise NotImplementedError("downgrade not supported for this migration")
