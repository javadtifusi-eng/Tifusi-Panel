"""Builds a sing-box-compatible JSON config — the third renderer over the
same access-resolved host list app/links/generator.py (URIs) and
app/subscription/clash.py (Clash YAML) already turn into their own formats.
sing-box clients (sing-box itself, SFA/SFI/SFM, Karing, ...) need a real
`outbounds`/`route` JSON document, not a URI list or Clash YAML.

l2tp/ikev2 have no sing-box outbound type and stay excluded here, same as
everywhere else this per-host builder pattern is used.
"""

import json

from app.links.generator import render_remark
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser


def _transport(host: Host) -> dict | None:
    inbound = host.inbound
    network = inbound.network
    path = host.effective_path
    host_header = host.effective_host_header

    if network == "ws":
        transport: dict = {"type": "ws"}
        if path:
            transport["path"] = path
        if host_header:
            transport["headers"] = {"Host": host_header}
        return transport
    if network == "grpc":
        transport = {"type": "grpc"}
        if path:
            transport["service_name"] = path
        return transport
    return None


def _tls(host: Host) -> dict | None:
    security = host.effective_security or "none"
    if security == "reality":
        inbound = host.inbound
        tls: dict = {"enabled": True}
        if host.effective_sni:
            tls["server_name"] = host.effective_sni
        tls["utls"] = {"enabled": True, "fingerprint": host.effective_fingerprint or "chrome"}
        tls["reality"] = {
            "enabled": True,
            "public_key": inbound.reality_public_key or "",
            "short_id": inbound.reality_short_id or "",
        }
        return tls
    if security == "tls":
        tls = {"enabled": True}
        if host.effective_sni:
            tls["server_name"] = host.effective_sni
        if host.effective_fingerprint:
            tls["utls"] = {"enabled": True, "fingerprint": host.effective_fingerprint}
        if host.allowinsecure:
            tls["insecure"] = True
        return tls
    return None


def _vless_outbound(user: ProxyUser, host: Host) -> dict:
    inbound = host.inbound
    out = {
        "type": "vless",
        "tag": render_remark(host, user),
        "server": host.address,
        "server_port": host.effective_port,
        "uuid": user.secret,
    }
    if inbound.flow:
        out["flow"] = inbound.flow
    transport = _transport(host)
    if transport:
        out["transport"] = transport
    tls = _tls(host)
    if tls:
        out["tls"] = tls
    return out


def _vmess_outbound(user: ProxyUser, host: Host) -> dict:
    out = {
        "type": "vmess",
        "tag": render_remark(host, user),
        "server": host.address,
        "server_port": host.effective_port,
        "uuid": user.secret,
        "security": "auto",
        "alter_id": 0,
    }
    transport = _transport(host)
    if transport:
        out["transport"] = transport
    tls = _tls(host)
    if tls:
        out["tls"] = tls
    return out


def _trojan_outbound(user: ProxyUser, host: Host) -> dict:
    out = {
        "type": "trojan",
        "tag": render_remark(host, user),
        "server": host.address,
        "server_port": host.effective_port,
        "password": user.secret,
    }
    transport = _transport(host)
    if transport:
        out["transport"] = transport
    tls = _tls(host) or {"enabled": True}
    if host.effective_sni:
        tls.setdefault("server_name", host.effective_sni)
    out["tls"] = tls
    return out


def _shadowsocks_outbound(user: ProxyUser, host: Host) -> dict:
    inbound = host.inbound
    return {
        "type": "shadowsocks",
        "tag": render_remark(host, user),
        "server": host.address,
        "server_port": host.effective_port,
        "method": inbound.encryption or "2022-blake3-aes-128-gcm",
        "password": user.secret,
    }


def _hysteria2_outbound(user: ProxyUser, host: Host) -> dict:
    out = {
        "type": "hysteria2",
        "tag": render_remark(host, user),
        "server": host.address,
        "server_port": host.effective_port,
        "password": user.secret,
    }
    tls = {"enabled": True}
    if host.effective_sni:
        tls["server_name"] = host.effective_sni
    out["tls"] = tls
    return out


_BUILDERS = {
    HostProtocol.vless: _vless_outbound,
    HostProtocol.vmess: _vmess_outbound,
    HostProtocol.trojan: _trojan_outbound,
    HostProtocol.shadowsocks: _shadowsocks_outbound,
    HostProtocol.hysteria2: _hysteria2_outbound,
}


def _dedupe_tags(outbounds: list[dict]) -> None:
    seen: dict[str, int] = {}
    for outbound in outbounds:
        tag = outbound["tag"]
        seen[tag] = seen.get(tag, 0) + 1
        if seen[tag] > 1:
            outbound["tag"] = f"{tag} ({seen[tag]})"


def build_singbox_config(user: ProxyUser, hosts: list[Host]) -> str:
    outbounds: list[dict] = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None and (host.inbound is not None or host.protocol == HostProtocol.hysteria2):
            outbounds.append(builder(user, host))

    _dedupe_tags(outbounds)
    tags = [o["tag"] for o in outbounds]

    config = {
        "dns": {"servers": [{"address": "1.1.1.1"}, {"address": "8.8.8.8"}]},
        "outbounds": [
            {"type": "selector", "tag": "select", "outbounds": (tags + ["direct"]) if tags else ["direct"]},
            *outbounds,
            {"type": "direct", "tag": "direct"},
        ],
        "route": {"final": "select"},
    }
    return json.dumps(config, indent=2, ensure_ascii=False)
