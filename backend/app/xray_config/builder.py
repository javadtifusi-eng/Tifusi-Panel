"""Turns Hosts + active ProxyUsers into an Xray-core config.json.

Xray-core itself only speaks VLESS and Trojan (among the protocols this
panel offers) — Hysteria2 is a separate standalone server and WireGuard
is a kernel/wg-quick affair, neither of which this module starts. Hosts
using either are skipped here for the same reason they're skipped in
app/links/generator.py: no half-working inbound is better than a real one.
"""

from app.models.host import Host, HostProtocol, HostSecurity
from app.models.user import ProxyUser, UserStatus


def _stream_settings(host: Host) -> dict:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "none"
    settings: dict = {"network": network, "security": security}

    if security == "reality":
        settings["realitySettings"] = {
            "show": False,
            "dest": f"{host.sni}:443",
            "serverNames": [host.sni],
            "privateKey": host.reality_private_key,
            "shortIds": [host.reality_short_id],
        }
    elif security == "tls" and host.sni:
        settings["tlsSettings"] = {"serverName": host.sni}

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
        "port": host.port,
        "protocol": "vless",
        "settings": {"clients": clients, "decryption": "none"},
        "streamSettings": _stream_settings(host),
    }


def _trojan_inbound(host: Host, users: list[ProxyUser]) -> dict:
    clients = [{"password": u.secret, "email": u.username} for u in users]
    return {
        "tag": f"host-{host.id}",
        "listen": "0.0.0.0",
        "port": host.port,
        "protocol": "trojan",
        "settings": {"clients": clients},
        "streamSettings": _stream_settings(host),
    }


_BUILDERS = {
    HostProtocol.vless: _vless_inbound,
    HostProtocol.trojan: _trojan_inbound,
}


def build_xray_config(hosts: list[Host], users: list[ProxyUser]) -> dict:
    active_users = [u for u in users if u.status == UserStatus.active]

    inbounds = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None:
            inbounds.append(builder(host, active_users))

    return {
        "log": {"loglevel": "warning"},
        "inbounds": inbounds,
        "outbounds": [{"protocol": "freedom", "tag": "direct"}],
    }
