"""Builds a Clash Meta (mihomo)-compatible YAML config from the same
resolved user/host data app/links/generator.py turns into vless://, trojan://
etc. URIs. Clash-family clients (Clash Meta, Clash Verge, Stash, ...) can't
consume that URI-list subscription format at all — they need a real
`proxies:`/`proxy-groups:`/`rules:` document — so this is a second, parallel
renderer over the exact same access-resolved host list, not a different
data source.

l2tp/ikev2 have no Clash proxy type and stay excluded here, same as they're
excluded from the URI list.
"""

import yaml

from app.links.generator import render_remark
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser


def _transport_opts(host: Host) -> dict:
    inbound = host.inbound
    network = inbound.network
    path = host.effective_path
    host_header = host.effective_host_header

    if network == "ws":
        opts: dict = {}
        if path:
            opts["path"] = path
        if host_header:
            opts["headers"] = {"Host": host_header}
        return {"network": "ws", "ws-opts": opts} if opts else {"network": "ws"}
    if network == "grpc":
        opts = {}
        if path:
            opts["grpc-service-name"] = path
        return {"network": "grpc", "grpc-opts": opts} if opts else {"network": "grpc"}
    # tcp/raw and anything else Clash doesn't have a dedicated transport
    # for — plain TCP is the correct fallback, not an error.
    return {}


def _tls_opts(host: Host) -> dict:
    security = host.effective_security or "none"
    opts: dict = {}
    if security == "reality":
        inbound = host.inbound
        opts["tls"] = True
        if host.effective_sni:
            opts["servername"] = host.effective_sni
        opts["client-fingerprint"] = host.effective_fingerprint or "chrome"
        opts["reality-opts"] = {
            "public-key": inbound.reality_public_key or "",
            "short-id": inbound.reality_short_id or "",
        }
    elif security == "tls":
        opts["tls"] = True
        if host.effective_sni:
            opts["servername"] = host.effective_sni
        if host.effective_fingerprint:
            opts["client-fingerprint"] = host.effective_fingerprint
        if host.allowinsecure:
            opts["skip-cert-verify"] = True
    return opts


def _vless_proxy(user: ProxyUser, host: Host) -> dict:
    inbound = host.inbound
    proxy = {
        "name": render_remark(host, user),
        "type": "vless",
        "server": host.address,
        "port": host.effective_port,
        "uuid": user.secret,
        "udp": True,
    }
    if inbound.flow:
        proxy["flow"] = inbound.flow
    proxy.update(_transport_opts(host))
    proxy.update(_tls_opts(host))
    return proxy


def _vmess_proxy(user: ProxyUser, host: Host) -> dict:
    proxy = {
        "name": render_remark(host, user),
        "type": "vmess",
        "server": host.address,
        "port": host.effective_port,
        "uuid": user.secret,
        "alterId": 0,
        "cipher": "auto",
        "udp": True,
    }
    proxy.update(_transport_opts(host))
    proxy.update(_tls_opts(host))
    return proxy


def _trojan_proxy(user: ProxyUser, host: Host) -> dict:
    proxy = {
        "name": render_remark(host, user),
        "type": "trojan",
        "server": host.address,
        "port": host.effective_port,
        "password": user.secret,
        "udp": True,
    }
    if host.effective_sni:
        proxy["sni"] = host.effective_sni
    if host.allowinsecure:
        proxy["skip-cert-verify"] = True
    proxy.update(_transport_opts(host))
    return proxy


def _shadowsocks_proxy(user: ProxyUser, host: Host) -> dict:
    inbound = host.inbound
    return {
        "name": render_remark(host, user),
        "type": "ss",
        "server": host.address,
        "port": host.effective_port,
        "cipher": inbound.encryption or "2022-blake3-aes-128-gcm",
        "password": user.secret,
        "udp": True,
    }


def _hysteria2_proxy(user: ProxyUser, host: Host) -> dict:
    proxy = {
        "name": render_remark(host, user),
        "type": "hysteria2",
        "server": host.address,
        "port": host.effective_port,
        "password": user.secret,
        "udp": True,
    }
    if host.effective_sni:
        proxy["sni"] = host.effective_sni
    return proxy


_BUILDERS = {
    HostProtocol.vless: _vless_proxy,
    HostProtocol.vmess: _vmess_proxy,
    HostProtocol.trojan: _trojan_proxy,
    HostProtocol.shadowsocks: _shadowsocks_proxy,
    HostProtocol.hysteria2: _hysteria2_proxy,
}


def _dedupe_names(proxies: list[dict]) -> None:
    # Clash requires unique proxy names — two hosts rendering to the same
    # remark (e.g. no {placeholder}s and identical text) would otherwise
    # silently collide in the client's proxy list.
    seen: dict[str, int] = {}
    for proxy in proxies:
        name = proxy["name"]
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            proxy["name"] = f"{name} ({seen[name]})"


def build_clash_config(user: ProxyUser, hosts: list[Host]) -> str:
    proxies: list[dict] = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None and (host.inbound is not None or host.protocol == HostProtocol.hysteria2):
            proxies.append(builder(user, host))

    _dedupe_names(proxies)
    names = [p["name"] for p in proxies]

    config = {
        "mixed-port": 7890,
        "mode": "rule",
        "log-level": "info",
        "proxies": proxies,
        "proxy-groups": [
            {"name": "PROXY", "type": "select", "proxies": (["auto"] + names) if names else ["DIRECT"]},
        ],
        "rules": ["MATCH,PROXY"],
    }
    if names:
        config["proxy-groups"].append(
            {"name": "auto", "type": "url-test", "proxies": names, "url": "http://www.gstatic.com/generate_204", "interval": 300}
        )

    return yaml.safe_dump(config, allow_unicode=True, sort_keys=False)
