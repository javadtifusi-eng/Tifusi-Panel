"""Turns Hosts + active ProxyUsers into an Xray-core config.json.

Xray-core itself only speaks VLESS/VMess/Trojan (among the protocols this
panel offers) — Hysteria2 is a separate standalone server and WireGuard
is a kernel/wg-quick affair, neither of which this module starts. Hosts
using either are skipped here for the same reason they're skipped in
app/links/generator.py: no half-working inbound is better than a real one.

Protocol/transport/security all come from the host's Core now, not the
host itself — see app/models/host.py's passthrough properties and
app/models/core.py.
"""

from app.groups.access import users_for_host
from app.models.host import Host, HostProtocol, HostSecurity
from app.models.user import ProxyUser, UserStatus


def _stream_settings(host: Host) -> dict:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "none"
    settings: dict = {"network": network, "security": security}

    if security == "reality":
        sni = host.effective_sni
        settings["realitySettings"] = {
            "show": False,
            "dest": f"{sni}:443",
            "serverNames": [sni],
            "privateKey": host.reality_private_key,
            "shortIds": [host.reality_short_id],
        }
    elif security == "tls":
        tls_settings: dict = {}
        if host.effective_sni:
            tls_settings["serverName"] = host.effective_sni
        if host.effective_alpn:
            tls_settings["alpn"] = [a.strip() for a in host.effective_alpn.split(",") if a.strip()]
        settings["tlsSettings"] = tls_settings

    if network == "ws":
        ws_settings: dict = {"path": host.path or "/"}
        if host.host_header:
            ws_settings["headers"] = {"Host": host.host_header}
        settings["wsSettings"] = ws_settings
    elif network == "grpc":
        settings["grpcSettings"] = {"serviceName": host.path or ""}

    return settings


def _vless_inbound(host: Host, users: list[ProxyUser]) -> dict:
    network = host.network.value if host.network else "tcp"
    use_vision = host.security == HostSecurity.reality and network == "tcp"
    clients = [
        {"id": u.secret, "email": u.username, **({"flow": "xtls-rprx-vision"} if use_vision else {})}
        for u in users
    ]
    return {
        "tag": f"host-{host.id}",
        "listen": "0.0.0.0",
        "port": host.effective_port,
        "protocol": "vless",
        "settings": {"clients": clients, "decryption": "none"},
        "streamSettings": _stream_settings(host),
    }


def _vmess_inbound(host: Host, users: list[ProxyUser]) -> dict:
    clients = [{"id": u.secret, "email": u.username} for u in users]
    return {
        "tag": f"host-{host.id}",
        "listen": "0.0.0.0",
        "port": host.effective_port,
        "protocol": "vmess",
        "settings": {"clients": clients},
        "streamSettings": _stream_settings(host),
    }


def _trojan_inbound(host: Host, users: list[ProxyUser]) -> dict:
    clients = [{"password": u.secret, "email": u.username} for u in users]
    return {
        "tag": f"host-{host.id}",
        "listen": "0.0.0.0",
        "port": host.effective_port,
        "protocol": "trojan",
        "settings": {"clients": clients},
        "streamSettings": _stream_settings(host),
    }


_BUILDERS = {
    HostProtocol.vless: _vless_inbound,
    HostProtocol.vmess: _vmess_inbound,
    HostProtocol.trojan: _trojan_inbound,
}

# node_agent/main.py's STATS_API_ADDR must point at this same port — it's
# how the node agent reads real per-user traffic back out of Xray (see
# app/traffic/sync.py), so the two sides have to agree on it independently.
STATS_API_PORT = 10085


def build_xray_config(hosts: list[Host], users: list[ProxyUser]) -> dict:
    active_users = [u for u in users if u.status == UserStatus.active]

    inbounds = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None:
            inbounds.append(builder(host, users_for_host(host, active_users)))

    # A loopback-only inbound exposing Xray's own StatsService — this is
    # what makes real traffic accounting possible instead of used_traffic
    # sitting there unused forever. It's always present, even with zero
    # hosts, since app/traffic/sync.py expects api statsquery to work
    # against every connected node.
    api_inbound = {
        "tag": "api",
        "listen": "127.0.0.1",
        "port": STATS_API_PORT,
        "protocol": "dokodemo-door",
        "settings": {"address": "127.0.0.1"},
    }

    return {
        "log": {"loglevel": "warning"},
        "api": {"tag": "api", "services": ["StatsService"]},
        "stats": {},
        "policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
        "inbounds": [api_inbound, *inbounds],
        "routing": {"rules": [{"type": "field", "inboundTag": ["api"], "outboundTag": "api"}]},
        "outbounds": [
            {"protocol": "freedom", "tag": "direct"},
            {"protocol": "freedom", "tag": "api"},
        ],
    }
