"""Parses protocol/transport/security/REALITY out of a raw Xray inbound
JSON object — mirroring PasarGuard's app/core/xray.py XRayConfig._read_inbound,
since in real Xray those fields live in the config JSON, not in anything a
panel invents. This is the single source of truth the panel reads to build
its Inbound registry (app/models/inbound.py) when a Core's config is saved,
and it's what link generation (app/links/generator.py) and the node config
builder (app/xray_config/builder.py) both read back off that registry.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.reality.keys import derive_x25519_public_key

# vmess/vless/trojan/shadowsocks are what Xray-core itself terminates as a
# TLS/TCP-style proxy inbound — hysteria/wireguard/mtproto are handled by
# entirely separate server processes this panel doesn't manage through Core.
SUPPORTED_PROTOCOLS = {"vless", "vmess", "trojan", "shadowsocks"}


@dataclass
class ParsedInbound:
    tag: str
    protocol: str
    port: int | None = None
    network: str = "tcp"
    security: str = "none"
    encryption: str | None = None
    flow: str | None = None
    header_type: str | None = None
    path: str | None = None
    host_header: str | None = None
    sni: str | None = None
    alpn: str | None = None
    fingerprint: str | None = None
    reality_public_key: str | None = None
    reality_short_id: str | None = None
    error: str | None = None


def _first(value: object) -> str | None:
    if isinstance(value, list):
        return str(value[0]) if value else None
    if isinstance(value, str):
        return value
    return None


def _join(value: object) -> str | None:
    if isinstance(value, list):
        joined = ",".join(str(v) for v in value if v)
        return joined or None
    if isinstance(value, str):
        return value or None
    return None


def _parse_network_settings(network: str, net_settings: dict, parsed: ParsedInbound) -> None:
    if network in ("tcp", "raw"):
        header = net_settings.get("header") or {}
        request = header.get("request") or {}
        parsed.header_type = header.get("type", "none")
        parsed.path = _first(request.get("path"))
        headers = request.get("headers")
        parsed.host_header = _join(headers.get("Host")) if isinstance(headers, dict) else None
    elif network == "ws":
        parsed.header_type = ""
        parsed.path = net_settings.get("path", "") or None
        host = net_settings.get("host")
        if not host:
            headers = net_settings.get("headers")
            host = headers.get("Host") if isinstance(headers, dict) else None
        parsed.host_header = host if isinstance(host, str) else _join(host)
    elif network == "grpc":
        parsed.header_type = ""
        parsed.path = net_settings.get("serviceName", "") or None
        parsed.host_header = net_settings.get("authority") or None
    elif network == "quic":
        parsed.header_type = (net_settings.get("header") or {}).get("type", "") or None
        parsed.path = net_settings.get("key", "") or None
        parsed.host_header = net_settings.get("security") or None
    elif network == "httpupgrade":
        parsed.path = net_settings.get("path", "") or None
        parsed.host_header = net_settings.get("host") or None
    elif network == "xhttp":
        parsed.path = net_settings.get("path", "") or None
        parsed.host_header = net_settings.get("host") or None
    elif network in ("http", "h2"):
        path = net_settings.get("path")
        parsed.path = _first(path) if isinstance(path, list) else (path or None)
        parsed.host_header = _join(net_settings.get("host"))
    elif network == "kcp":
        parsed.header_type = (net_settings.get("header") or {}).get("type", "none")


def parse_inbound(inbound: dict) -> ParsedInbound | None:
    """None means "not a proxy inbound this panel manages" (unknown tag or
    unsupported protocol) — silently skipped, same as PasarGuard does for
    inbounds it doesn't recognize (e.g. a plain dokodemo-door)."""
    protocol = inbound.get("protocol")
    tag = inbound.get("tag")
    if not tag or protocol not in SUPPORTED_PROTOCOLS:
        return None

    parsed = ParsedInbound(tag=tag, protocol=protocol)

    port = inbound.get("port")
    try:
        parsed.port = int(port) if port is not None else None
    except (TypeError, ValueError):
        parsed.port = None

    settings = inbound.get("settings") or {}

    if protocol == "vless":
        parsed.flow = settings.get("flow") or None
        decryption = settings.get("decryption", "none")
        encryption = settings.get("encryption", "none")
        if decryption != "none" and encryption in ("", "none", None):
            parsed.error = f"'encryption' must be set in {tag}'s settings when decryption isn't none"
            return parsed
        parsed.encryption = encryption
    elif protocol == "shadowsocks":
        parsed.encryption = settings.get("method", "")

    stream = inbound.get("streamSettings") or {}
    network = stream.get("network", "tcp")
    parsed.network = network
    net_settings = stream.get(f"{network}Settings", {}) or {}
    security = stream.get("security") or "none"
    parsed.security = security
    tls_settings = stream.get(f"{security}Settings", {}) or {}

    if security == "tls":
        parsed.sni = tls_settings.get("serverName") or _first(tls_settings.get("serverNames"))
        parsed.alpn = _join(tls_settings.get("alpn"))
        parsed.fingerprint = tls_settings.get("fingerprint") or None
    elif security == "reality":
        parsed.sni = _first(tls_settings.get("serverNames"))
        parsed.fingerprint = tls_settings.get("fingerprint", "chrome")

        private_key = tls_settings.get("privateKey")
        if not private_key:
            parsed.error = f"realitySettings.privateKey is required in {tag}"
            return parsed
        try:
            parsed.reality_public_key = derive_x25519_public_key(private_key)
        except Exception:
            parsed.error = f"realitySettings.privateKey in {tag} is not a valid X25519 key"
            return parsed

        parsed.reality_short_id = _first(tls_settings.get("shortIds"))
        if not parsed.reality_short_id:
            parsed.error = f"realitySettings.shortIds needs at least one entry in {tag}"
            return parsed

    _parse_network_settings(network, net_settings, parsed)
    return parsed


def parse_inbounds(config: dict) -> list[ParsedInbound]:
    inbounds = config.get("inbounds")
    if not isinstance(inbounds, list):
        return []
    parsed: list[ParsedInbound] = []
    for inbound in inbounds:
        if not isinstance(inbound, dict):
            continue
        result = parse_inbound(inbound)
        if result is not None:
            parsed.append(result)
    return parsed
