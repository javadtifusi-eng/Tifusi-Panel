"""core as raw xray json with inbound registry

Revision ID: 1fc38d7e8d1b
Revises: 91d4e7a822c1
Create Date: 2026-09-06 13:00:00.000000

"""
import base64
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey


# revision identifiers, used by Alembic.
revision: str = '1fc38d7e8d1b'
down_revision: Union[str, Sequence[str], None] = '91d4e7a822c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_XRAY_PROTOCOLS = {"vless", "vmess", "trojan"}


def _b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _derive_public_key(private_key_b64url: str) -> str | None:
    try:
        padded = private_key_b64url + "=" * (-len(private_key_b64url) % 4)
        priv_bytes = base64.urlsafe_b64decode(padded)
        pub = X25519PrivateKey.from_private_bytes(priv_bytes).public_key()
        pub_bytes = pub.public_bytes(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
        return _b64url_nopad(pub_bytes)
    except Exception:
        return None


def upgrade() -> None:
    connection = op.get_bind()

    op.add_column('cores', sa.Column('config', sa.JSON(), nullable=True))

    old_cores = connection.execute(sa.text(
        "SELECT id, protocol, network, security, default_port, sni, fingerprint, alpn, path, host_header, "
        "reality_public_key, reality_private_key, reality_short_id, "
        "wireguard_public_key, wireguard_private_key, wireguard_subnet "
        "FROM cores"
    )).fetchall()

    op.create_table(
        'inbounds',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tag', sa.String(length=256), nullable=False),
        sa.Column('core_id', sa.Integer(), sa.ForeignKey('cores.id', ondelete='CASCADE'), nullable=False),
        sa.Column('protocol', sa.String(length=32), nullable=False),
        sa.Column('network', sa.String(length=32), nullable=False, server_default='tcp'),
        sa.Column('security', sa.String(length=16), nullable=False, server_default='none'),
        sa.Column('port', sa.Integer(), nullable=True),
        sa.Column('encryption', sa.String(length=32), nullable=True),
        sa.Column('flow', sa.String(length=32), nullable=True),
        sa.Column('header_type', sa.String(length=16), nullable=True),
        sa.Column('path', sa.String(length=255), nullable=True),
        sa.Column('host_header', sa.String(length=255), nullable=True),
        sa.Column('sni', sa.String(length=255), nullable=True),
        sa.Column('alpn', sa.String(length=64), nullable=True),
        sa.Column('fingerprint', sa.String(length=32), nullable=True),
        sa.Column('reality_public_key', sa.String(length=64), nullable=True),
        sa.Column('reality_short_id', sa.String(length=16), nullable=True),
    )
    op.create_index('ix_inbounds_tag', 'inbounds', ['tag'], unique=True)

    op.create_table(
        'group_inbounds',
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('groups.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('inbound_id', sa.Integer(), sa.ForeignKey('inbounds.id', ondelete='CASCADE'), primary_key=True),
    )

    # core_id -> protocol/extra fields, kept in memory since the columns
    # they came from get dropped from `cores` a bit further down.
    core_protocol: dict[int, str] = {}
    core_extra: dict[int, dict] = {}

    for row in old_cores:
        (
            core_id, protocol, network, security, default_port, sni, fingerprint, alpn, path, host_header,
            reality_public_key, reality_private_key, reality_short_id,
            wireguard_public_key, wireguard_private_key, wireguard_subnet,
        ) = row
        core_protocol[core_id] = protocol
        core_extra[core_id] = {
            "sni": sni,
            "default_port": default_port,
            "wireguard_public_key": wireguard_public_key,
            "wireguard_private_key": wireguard_private_key,
            "wireguard_subnet": wireguard_subnet,
        }

        if protocol not in _XRAY_PROTOCOLS:
            # wireguard/hysteria2 cores never had real Xray JSON to begin
            # with — their fields move onto the Host directly (see below).
            connection.execute(
                sa.text("UPDATE cores SET config = :config WHERE id = :id"),
                {"config": json.dumps({"inbounds": []}), "id": core_id},
            )
            continue

        network = network or "tcp"
        security = security or "none"
        tag = f"core-{core_id}"
        stream_settings: dict = {"network": network, "security": security}

        pbk = reality_public_key
        if security == "reality":
            if reality_private_key:
                pbk = _derive_public_key(reality_private_key) or reality_public_key
            stream_settings["realitySettings"] = {
                "show": False,
                "dest": f"{sni or 'www.example.com'}:443",
                "serverNames": [sni] if sni else [],
                "privateKey": reality_private_key,
                "shortIds": [reality_short_id] if reality_short_id else [],
                "fingerprint": fingerprint or "chrome",
            }
        elif security == "tls":
            tls_settings: dict = {}
            if sni:
                tls_settings["serverName"] = sni
            if alpn:
                tls_settings["alpn"] = [a.strip() for a in alpn.split(",") if a.strip()]
            if fingerprint:
                tls_settings["fingerprint"] = fingerprint
            stream_settings["tlsSettings"] = tls_settings

        if network == "ws":
            ws_settings: dict = {"path": path or "/"}
            if host_header:
                ws_settings["headers"] = {"Host": host_header}
            stream_settings["wsSettings"] = ws_settings
        elif network == "grpc":
            stream_settings["grpcSettings"] = {"serviceName": path or ""}

        flow = "xtls-rprx-vision" if (protocol == "vless" and security == "reality" and network == "tcp") else None
        settings: dict = {"clients": []}
        if protocol == "vless":
            settings["decryption"] = "none"
            if flow:
                settings["flow"] = flow

        config = {
            "inbounds": [
                {
                    "tag": tag,
                    "listen": "0.0.0.0",
                    "port": default_port or 443,
                    "protocol": protocol,
                    "settings": settings,
                    "streamSettings": stream_settings,
                }
            ]
        }
        connection.execute(
            sa.text("UPDATE cores SET config = :config WHERE id = :id"),
            {"config": json.dumps(config), "id": core_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO inbounds (tag, core_id, protocol, network, security, port, encryption, flow, "
                "header_type, path, host_header, sni, alpn, fingerprint, reality_public_key, reality_short_id) "
                "VALUES (:tag, :core_id, :protocol, :network, :security, :port, :encryption, :flow, "
                ":header_type, :path, :host_header, :sni, :alpn, :fingerprint, :reality_public_key, :reality_short_id)"
            ),
            {
                "tag": tag,
                "core_id": core_id,
                "protocol": protocol,
                "network": network,
                "security": security,
                "port": default_port,
                "encryption": "none" if protocol == "vless" else None,
                "flow": flow,
                "header_type": "none" if network == "tcp" else "",
                "path": path,
                "host_header": host_header,
                "sni": sni,
                "alpn": alpn,
                "fingerprint": fingerprint,
                "reality_public_key": pbk,
                "reality_short_id": reality_short_id,
            },
        )

    connection.execute(
        sa.text("UPDATE cores SET config = :config WHERE config IS NULL"),
        {"config": json.dumps({"inbounds": []})},
    )

    with op.batch_alter_table('cores', schema=None) as batch_op:
        batch_op.alter_column('config', existing_type=sa.JSON(), nullable=False)
        batch_op.drop_column('protocol')
        batch_op.drop_column('network')
        batch_op.drop_column('security')
        batch_op.drop_column('default_port')
        batch_op.drop_column('sni')
        batch_op.drop_column('fingerprint')
        batch_op.drop_column('alpn')
        batch_op.drop_column('path')
        batch_op.drop_column('host_header')
        batch_op.drop_column('reality_public_key')
        batch_op.drop_column('reality_private_key')
        batch_op.drop_column('reality_short_id')
        batch_op.drop_column('wireguard_public_key')
        batch_op.drop_column('wireguard_private_key')
        batch_op.drop_column('wireguard_subnet')

    inbound_by_core: dict[int, int] = dict(
        connection.execute(sa.text("SELECT core_id, id FROM inbounds")).fetchall()
    )

    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('protocol', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('inbound_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('port_override', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('fingerprint_override', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('path_override', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('host_header_override', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('security_override', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('allowinsecure', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('wireguard_public_key', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('wireguard_private_key', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('wireguard_subnet', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('wireguard_port', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('hysteria2_sni', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('hysteria2_port', sa.Integer(), nullable=True))

    old_hosts = connection.execute(sa.text("SELECT id, core_id, port, sni_override FROM hosts")).fetchall()
    for host_id, core_id, port, sni_override in old_hosts:
        protocol = core_protocol.get(core_id, "vless")
        extra = core_extra.get(core_id, {})

        if protocol in _XRAY_PROTOCOLS:
            connection.execute(
                sa.text(
                    "UPDATE hosts SET protocol = :protocol, inbound_id = :inbound_id, port_override = :port "
                    "WHERE id = :id"
                ),
                {
                    "protocol": protocol,
                    "inbound_id": inbound_by_core.get(core_id),
                    "port": port,
                    "id": host_id,
                },
            )
        elif protocol == "wireguard":
            connection.execute(
                sa.text(
                    "UPDATE hosts SET protocol = :protocol, wireguard_public_key = :pub, "
                    "wireguard_private_key = :priv, wireguard_subnet = :subnet, wireguard_port = :port "
                    "WHERE id = :id"
                ),
                {
                    "protocol": protocol,
                    "pub": extra.get("wireguard_public_key"),
                    "priv": extra.get("wireguard_private_key"),
                    "subnet": extra.get("wireguard_subnet"),
                    "port": port if port is not None else extra.get("default_port"),
                    "id": host_id,
                },
            )
        elif protocol == "hysteria2":
            connection.execute(
                sa.text(
                    "UPDATE hosts SET protocol = :protocol, hysteria2_sni = :sni, hysteria2_port = :port "
                    "WHERE id = :id"
                ),
                {
                    "protocol": protocol,
                    "sni": sni_override or extra.get("sni"),
                    "port": port if port is not None else extra.get("default_port"),
                    "id": host_id,
                },
            )

    connection.execute(sa.text("UPDATE hosts SET protocol = 'vless' WHERE protocol IS NULL"))

    with op.batch_alter_table('hosts', schema=None) as batch_op:
        batch_op.alter_column('protocol', existing_type=sa.String(length=32), nullable=False)
        batch_op.create_foreign_key('fk_hosts_inbound_id', 'inbounds', ['inbound_id'], ['id'])
        batch_op.drop_column('core_id')
        batch_op.drop_column('port')


def downgrade() -> None:
    """This redesign isn't meaningfully reversible — the old discrete
    protocol/transport columns can't be reconstructed from an admin's own
    freeform Xray JSON. Not implemented, same as the previous Core
    migration's downgrade would also have lost data going the other way."""
    raise NotImplementedError("downgrade not supported for this migration")
