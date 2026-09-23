import base64
import json
from datetime import datetime, timezone
from urllib.parse import quote, urlencode

from app.models.host import Host, HostProtocol
from app.models.inbound import Inbound
from app.models.user import ProxyUser
from app.wireguard import keys as wg_keys

_BYTES_PER_GB = 1024**3


def render_remark(host: Host, user: ProxyUser) -> str:
    """Fill {placeholder} tokens in a host's remark with this user's own
    values — expiry/traffic are per-user, so this can't be precomputed once
    on the host the way the rest of its config is."""
    template = host.remark
    if "{" not in template:
        return template

    days_left = "∞"
    expire_date = "-"
    if user.expire is not None:
        expire_at = user.expire if user.expire.tzinfo else user.expire.replace(tzinfo=timezone.utc)
        days_left = str(max(0, (expire_at - datetime.now(timezone.utc)).days))
        expire_date = expire_at.strftime("%Y-%m-%d")

    data_limit_gb = "∞"
    data_left_gb = "∞"
    if user.data_limit is not None:
        data_limit_gb = f"{user.data_limit / _BYTES_PER_GB:.1f}"
        data_left_gb = f"{max(0, user.data_limit - user.used_traffic) / _BYTES_PER_GB:.1f}"

    values = {
        "username": user.username,
        "protocol": host.protocol.value if host.protocol else "",
        "days_left": days_left,
        "expire_date": expire_date,
        "data_limit_gb": data_limit_gb,
        "data_left_gb": data_left_gb,
    }
    result = template
    for key, value in values.items():
        result = result.replace("{" + key + "}", value)
    return result


def _fragment(remark: str) -> str:
    return quote(remark, safe="")


def _transport_params(inbound: Inbound, host: Host) -> dict[str, str]:
    """path/serviceName + Host header — sourced from the Inbound's parsed
    Xray JSON, with the Host's own overrides layered on top. Same shape for
    every URI-scheme protocol."""
    params: dict[str, str] = {}
    network = inbound.network
    path = host.effective_path
    host_header = host.effective_host_header
    xhttp_mode = inbound.xhttp_mode
    xhttp_extra = inbound.xhttp_extra

    if network in ("tcp", "raw"):
        params["headerType"] = inbound.header_type or "none"
        if path:
            params["path"] = path
        if host_header:
            params["host"] = host_header
    elif network == "ws":
        if path:
            params["path"] = path
        if host_header:
            params["host"] = host_header
    elif network == "grpc":
        if path:
            params["serviceName"] = path
        if host_header:
            params["authority"] = host_header
    elif network in ("http", "h2", "httpupgrade", "xhttp", "quic"):
        params["type"] = network
        if path:
            params["path"] = path
        if host_header:
            params["host"] = host_header
        if network == "xhttp":
            # `mode` and `extra` only mean anything to the client, and the link
            # is the only way they reach it. A client that doesn't know them
            # ignores them, which is why they are safe to always send.
            if xhttp_mode:
                params["mode"] = xhttp_mode
            if xhttp_extra:
                params["extra"] = xhttp_extra
    return params


def _security_params(host: Host) -> dict[str, str]:
    """sni/fp/alpn/pbk/sid/allowInsecure — Host overrides win over the
    Inbound's own defaults; pbk/sid never come from the Host, they're always
    derived from the Inbound's realitySettings.privateKey."""
    inbound = host.inbound
    security = host.effective_security or "none"
    params: dict[str, str] = {}

    if security == "reality":
        params["sni"] = host.effective_sni or ""
        fp = host.effective_fingerprint or "chrome"
        if fp:
            params["fp"] = fp
        params["pbk"] = inbound.reality_public_key or ""
        params["sid"] = inbound.reality_short_id or ""
    elif security == "tls":
        if host.effective_sni:
            params["sni"] = host.effective_sni
        if host.effective_fingerprint:
            params["fp"] = host.effective_fingerprint
        if host.effective_alpn:
            params["alpn"] = host.effective_alpn
        if host.allowinsecure:
            params["allowInsecure"] = "1"

    return params


def _fragment_param(host: Host, security: str) -> dict[str, str]:
    """TLS Client Hello fragmentation — splits the handshake into pieces so
    DPI can't pattern-match a whole ClientHello in one packet. Purely a
    client-side instruction (v2rayNG/NekoBox/etc. read this query param and
    do the splitting themselves); the node's own Xray config is untouched.
    Only meaningful once there's an actual TLS handshake to fragment."""
    if security not in ("tls", "reality") or not host.fragment_length:
        return {}
    interval = host.fragment_interval or "10-20"
    packets = host.fragment_packets or "tlshello"
    return {"fragment": f"{host.fragment_length},{interval},{packets}"}


def build_vless_link(user: ProxyUser, host: Host) -> str:
    inbound = host.inbound
    security = host.effective_security or "none"
    params: dict[str, str] = {"type": inbound.network, "security": security}
    params["encryption"] = inbound.encryption or "none"
    if inbound.flow:
        params["flow"] = inbound.flow
    params.update(_transport_params(inbound, host))
    params.update(_security_params(host))
    params.update(_fragment_param(host, security))

    return f"vless://{user.secret}@{host.address}:{host.effective_port}?{urlencode(params)}#{_fragment(render_remark(host, user))}"


def build_vmess_link(user: ProxyUser, host: Host) -> str:
    inbound = host.inbound
    security = host.effective_security or "none"
    obj = {
        "v": "2",
        "ps": render_remark(host, user),
        "add": host.address,
        "port": str(host.effective_port),
        "id": user.secret,
        "aid": "0",
        "scy": "auto",
        "net": inbound.network,
        "type": inbound.header_type or "none",
        "host": host.effective_host_header or "",
        "path": host.effective_path or "",
        "tls": "tls" if security == "tls" else ("reality" if security == "reality" else ""),
        "sni": host.effective_sni or "",
        "alpn": host.effective_alpn or "",
        "fp": host.effective_fingerprint or "",
    }
    fragment = _fragment_param(host, security)
    if fragment:
        obj["fragment"] = fragment["fragment"]
    encoded = base64.b64encode(json.dumps(obj).encode()).decode()
    return f"vmess://{encoded}"


def build_trojan_link(user: ProxyUser, host: Host) -> str:
    inbound = host.inbound
    security = host.effective_security or "tls"
    params: dict[str, str] = {"type": inbound.network, "security": security}
    params.update(_transport_params(inbound, host))
    params.update(_security_params(host))
    params.update(_fragment_param(host, security))

    return f"trojan://{user.secret}@{host.address}:{host.effective_port}?{urlencode(params)}#{_fragment(render_remark(host, user))}"


def build_shadowsocks_link(user: ProxyUser, host: Host) -> str:
    inbound = host.inbound
    method = inbound.encryption or "2022-blake3-aes-128-gcm"
    userinfo = base64.b64encode(f"{method}:{user.secret}".encode()).decode()
    return f"ss://{userinfo}@{host.address}:{host.effective_port}#{_fragment(render_remark(host, user))}"


def build_hysteria2_link(user: ProxyUser, host: Host) -> str:
    params: dict[str, str] = {}
    if host.effective_sni:
        params["sni"] = host.effective_sni
    obfs = host.effective_hysteria2_obfs
    if obfs:
        params["obfs"] = "salamander"
        params["obfs-password"] = obfs
    suffix = f"?{urlencode(params)}" if params else ""
    return f"hysteria2://{user.secret}@{host.address}:{host.effective_port}{suffix}#{_fragment(render_remark(host, user))}"


def build_wireguard_link(user: ProxyUser, host: Host) -> str | None:
    """wireguard://<user private key>@host:port?publickey=...&address=...&mtu=...

    The format V2Box, v2rayNG and Hiddify import. The key is the user's own,
    derived from the core (app/wireguard/keys.py), so it is the same one the
    node was told about."""
    core = host.core
    if core is None or not core.wireguard_private_key:
        return None
    params = {
        "publickey": wg_keys.public_key(core.wireguard_private_key),
        "address": f"{wg_keys.user_address(user.id)}/32",
        "mtu": str(core.wireguard_mtu or wg_keys.DEFAULT_MTU),
    }
    private_key = quote(wg_keys.user_private_key(core.wireguard_private_key, user.secret), safe="")
    return (
        f"wireguard://{private_key}@{host.address}:{host.effective_port}"
        f"?{urlencode(params)}#{_fragment(render_remark(host, user))}"
    )


def build_wireguard_conf(user: ProxyUser, host: Host) -> str | None:
    """The same tunnel as build_wireguard_link, as the .conf file the official
    WireGuard apps import (they take a file or its QR code, not a link)."""
    core = host.core
    if core is None or not core.wireguard_private_key:
        return None
    return (
        "[Interface]\n"
        f"PrivateKey = {wg_keys.user_private_key(core.wireguard_private_key, user.secret)}\n"
        f"Address = {wg_keys.user_address(user.id)}/32\n"
        "DNS = 1.1.1.1, 8.8.8.8\n"
        f"MTU = {core.wireguard_mtu or wg_keys.DEFAULT_MTU}\n"
        "\n"
        "[Peer]\n"
        f"PublicKey = {wg_keys.public_key(core.wireguard_private_key)}\n"
        "AllowedIPs = 0.0.0.0/0\n"
        f"Endpoint = {host.address}:{host.effective_port}\n"
        # Mobile NAT forgets an idle UDP mapping within seconds to minutes.
        "PersistentKeepalive = 25\n"
    )


# l2tp/ikev2 have no importable URI scheme at all (see the routers, which
# hand those out as plain connection fields instead) — excluded here rather
# than emitting a link that can't work.
_BUILDERS = {
    HostProtocol.vless: build_vless_link,
    HostProtocol.vmess: build_vmess_link,
    HostProtocol.trojan: build_trojan_link,
    HostProtocol.shadowsocks: build_shadowsocks_link,
    HostProtocol.hysteria2: build_hysteria2_link,
    HostProtocol.wireguard: build_wireguard_link,
}

# Hosts that stand on a Core rather than an Xray Inbound.
_CORE_HOSTED = (HostProtocol.hysteria2, HostProtocol.wireguard)


def build_links_for_user(user: ProxyUser, hosts: list[Host]) -> list[str]:
    links = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None and (host.inbound is not None or host.protocol in _CORE_HOSTED):
            link = builder(user, host)
            if link:
                links.append(link)
    return links


def build_subscription_content(links: list[str]) -> str:
    return base64.b64encode("\n".join(links).encode()).decode()


def build_ipsec_configs_for_user(
    user: ProxyUser, hosts: list[Host], base_url: str
) -> tuple[list[dict], list[dict]]:
    """ikev2/l2tp have no URI scheme — iOS/Android/strongSwan set them up
    from plain fields (server, PSK, and a per-user username/password for
    EAP-MSCHAPv2/CHAP login), not an importable link, so each gets its own
    field of raw connection info instead of joining build_links_for_user's
    list. Shared by the admin-facing links endpoint (app/routers/users.py)
    and the public subscription HTML page (app/routers/subscription.py) so
    the two don't drift. `base_url` must already end in "/"."""
    ikev2_configs = [
        {
            "remark": render_remark(host, user),
            "server": host.address,
            "remote_id": (host.core.ikev2_remote_id if host.core else None) or host.address,
            # PSK is only meaningful in "psk" auth mode (see node_agent/ipsec.py)
            # — showing it in "eap" mode as well would be actively misleading,
            # since it plays no part in that mode's actual authentication.
            "psk": host.core.ikev2_psk if host.core and host.core.ikev2_auth_mode == "psk" else None,
            "username": user.username,
            "password": user.ipsec_login_password,
            # The node's own cert is self-signed (admin-provided or the
            # node's own auto-generated fallback — see node_agent/ipsec.py),
            # so a client needs this to actually trust it. None here (no
            # admin-provided cert) means the QR import just won't carry a
            # pinned cert — see QrImport.kt on the app side for how that's
            # handled (falls back to system CA trust, which fails against a
            # self-signed cert, same as before this existed).
            "certificate": host.core.ikev2_certificate if host.core else None,
            # Tap-to-install iOS/macOS profile (Connect On Demand included) —
            # an alternative to typing the fields above into Settings > VPN.
            "mobileconfig_url": f"{base_url}sub/{user.secret}/ikev2.mobileconfig",
        }
        for host in hosts
        if host.protocol == HostProtocol.ikev2
    ]
    l2tp_configs = [
        {
            "remark": render_remark(host, user),
            "server": host.address,
            "psk": host.core.l2tp_psk if host.core else None,
            "username": user.username,
            "password": user.ipsec_login_password,
        }
        for host in hosts
        if host.protocol == HostProtocol.l2tp
    ]
    return ikev2_configs, l2tp_configs
