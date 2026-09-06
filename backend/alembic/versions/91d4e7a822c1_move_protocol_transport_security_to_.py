"""move protocol transport security to core, add vmess

Revision ID: 91d4e7a822c1
Revises: 24216a8b216b
Create Date: 2026-09-06 11:41:05.678926

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '91d4e7a822c1'
down_revision: Union[str, Sequence[str], None] = '24216a8b216b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('cores', sa.Column('protocol', sa.Enum('vless', 'vmess', 'trojan', 'wireguard', 'hysteria2', name='hostprotocol'), nullable=True))
    op.add_column('cores', sa.Column('network', sa.Enum('tcp', 'ws', 'grpc', name='hostnetwork'), nullable=True))
    op.add_column('cores', sa.Column('security', sa.Enum('none', 'tls', 'reality', name='hostsecurity'), nullable=True))
    op.add_column('cores', sa.Column('default_port', sa.Integer(), nullable=True))
    op.add_column('cores', sa.Column('sni', sa.String(length=255), nullable=True))
    op.add_column('cores', sa.Column('fingerprint', sa.String(length=32), nullable=True))
    op.add_column('cores', sa.Column('alpn', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('path', sa.String(length=255), nullable=True))
    op.add_column('cores', sa.Column('host_header', sa.String(length=255), nullable=True))
    op.add_column('cores', sa.Column('reality_public_key', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('reality_private_key', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('reality_short_id', sa.String(length=16), nullable=True))
    op.add_column('cores', sa.Column('wireguard_public_key', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('wireguard_private_key', sa.String(length=64), nullable=True))
    op.add_column('cores', sa.Column('wireguard_subnet', sa.String(length=32), nullable=True))

    # Best-effort: carry each existing core-group's protocol/transport/
    # security/keys up onto the Core itself, from whichever host in it has
    # them set (this is a brand-new, not-yet-widely-deployed feature, so
    # there's no expectation of multiple hosts per core disagreeing on
    # these — if they do, one of them wins and the admin re-checks it).
    connection = op.get_bind()
    rows = connection.execute(sa.text(
        "SELECT core_id, protocol, network, security, sni, "
        "reality_public_key, reality_private_key, reality_short_id, "
        "wireguard_public_key, wireguard_private_key, wireguard_subnet, port "
        "FROM hosts WHERE protocol IS NOT NULL"
    )).fetchall()
    seen_cores: set[int] = set()
    for row in rows:
        core_id = row[0]
        if core_id is None or core_id in seen_cores:
            continue
        seen_cores.add(core_id)
        connection.execute(
            sa.text(
                "UPDATE cores SET protocol = :protocol, network = :network, security = :security, "
                "sni = :sni, reality_public_key = :reality_public_key, "
                "reality_private_key = :reality_private_key, reality_short_id = :reality_short_id, "
                "wireguard_public_key = :wireguard_public_key, wireguard_private_key = :wireguard_private_key, "
                "wireguard_subnet = :wireguard_subnet, default_port = :default_port "
                "WHERE id = :core_id"
            ),
            {
                "protocol": row[1],
                "network": row[2],
                "security": row[3],
                "sni": row[4],
                "reality_public_key": row[5],
                "reality_private_key": row[6],
                "reality_short_id": row[7],
                "wireguard_public_key": row[8],
                "wireguard_private_key": row[9],
                "wireguard_subnet": row[10],
                "default_port": row[11],
                "core_id": core_id,
            },
        )
    # Any core nobody's data reached (or with no hosts at all) still needs a
    # protocol so it satisfies the NOT NULL app-level expectation — default
    # it to vless so the panel doesn't crash reading it; the admin can (and,
    # per this whole redesign, should explicitly) edit it from the Cores page.
    connection.execute(sa.text("UPDATE cores SET protocol = 'vless' WHERE protocol IS NULL"))
    # A host with no core_id at all shouldn't be possible, but if one
    # somehow exists, point it at *some* core rather than failing the
    # upcoming NOT NULL constraint outright.
    connection.execute(sa.text(
        "UPDATE hosts SET core_id = (SELECT id FROM cores ORDER BY id LIMIT 1) WHERE core_id IS NULL"
    ))

    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sni_override', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('alpn_override', sa.String(length=64), nullable=True))
        batch_op.alter_column('port', existing_type=sa.INTEGER(), nullable=True)
        batch_op.alter_column('core_id', existing_type=sa.INTEGER(), nullable=False)
        batch_op.drop_column('wireguard_private_key')
        batch_op.drop_column('network')
        batch_op.drop_column('wireguard_subnet')
        batch_op.drop_column('protocol')
        batch_op.drop_column('reality_private_key')
        batch_op.drop_column('security')
        batch_op.drop_column('reality_public_key')
        batch_op.drop_column('wireguard_public_key')
        batch_op.drop_column('sni')
        batch_op.drop_column('reality_short_id')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('reality_short_id', sa.VARCHAR(length=16), nullable=True))
        batch_op.add_column(sa.Column('sni', sa.VARCHAR(length=255), nullable=True))
        batch_op.add_column(sa.Column('wireguard_public_key', sa.VARCHAR(length=64), nullable=True))
        batch_op.add_column(sa.Column('reality_public_key', sa.VARCHAR(length=64), nullable=True))
        batch_op.add_column(sa.Column('security', sa.VARCHAR(length=7), nullable=True))
        batch_op.add_column(sa.Column('reality_private_key', sa.VARCHAR(length=64), nullable=True))
        batch_op.add_column(sa.Column('protocol', sa.VARCHAR(length=9), nullable=True))
        batch_op.add_column(sa.Column('wireguard_subnet', sa.VARCHAR(length=32), nullable=True))
        batch_op.add_column(sa.Column('network', sa.VARCHAR(length=4), nullable=True))
        batch_op.add_column(sa.Column('wireguard_private_key', sa.VARCHAR(length=64), nullable=True))
        batch_op.alter_column('core_id', existing_type=sa.INTEGER(), nullable=True)
        batch_op.alter_column('port', existing_type=sa.INTEGER(), nullable=False)
        batch_op.drop_column('alpn_override')
        batch_op.drop_column('sni_override')

    op.drop_column('cores', 'wireguard_subnet')
    op.drop_column('cores', 'wireguard_private_key')
    op.drop_column('cores', 'wireguard_public_key')
    op.drop_column('cores', 'reality_short_id')
    op.drop_column('cores', 'reality_private_key')
    op.drop_column('cores', 'reality_public_key')
    op.drop_column('cores', 'host_header')
    op.drop_column('cores', 'path')
    op.drop_column('cores', 'alpn')
    op.drop_column('cores', 'fingerprint')
    op.drop_column('cores', 'sni')
    op.drop_column('cores', 'default_port')
    op.drop_column('cores', 'security')
    op.drop_column('cores', 'network')
    op.drop_column('cores', 'protocol')
