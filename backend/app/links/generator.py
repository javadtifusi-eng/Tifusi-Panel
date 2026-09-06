import base64
import json
from datetime import datetime, timezone
from urllib.parse import quote, urlencode

from app.models.host import Host, HostProtocol
from app.models.inbound import Inbound
from app.models.user import ProxyUser

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


def build_vless_link(user: ProxyUser, host: Host) -> str:
    inbound = host.inbound
    security = host.effective_security or "none"
    params: dict[str, str] = {"type": inbound.network, "security": security}
    params["encryption"] = inbound.encryption or "none"
    if inbound.flow:
        params["flow"] = inbound.flow
    params.update(_transport_params(inbound, host))
    params.update(_security_params(host))

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
    encoded = base64.b64encode(json.dumps(obj).encode()).decode()
    return f"vmess://{encoded}"


def build_trojan_link(user: ProxyUser, host: Host) -> str:
    inbound = host.inbound
    security = host.effective_security or "tls"
    params: dict[str, str] = {"type": inbound.network, "security": security}
    params.update(_transport_params(inbound, host))
    params.update(_security_params(host))

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
    suffix = f"?{urlencode(params)}" if params else ""
    return f"hysteria2://{user.secret}@{host.address}:{host.effective_port}{suffix}#{_fragment(render_remark(host, user))}"


# WireGuard needs a per-user keypair and an allocated tunnel IP, which nothing
# generates yet — it's excluded here rather than emitting a link that can't work.
_BUILDERS = {
    HostProtocol.vless: build_vless_link,
    HostProtocol.vmess: build_vmess_link,
    HostProtocol.trojan: build_trojan_link,
    HostProtocol.shadowsocks: build_shadowsocks_link,
    HostProtocol.hysteria2: build_hysteria2_link,
}


def build_links_for_user(user: ProxyUser, hosts: list[Host]) -> list[str]:
    links = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None and (host.inbound is not None or host.protocol == HostProtocol.hysteria2):
            links.append(builder(user, host))
    return links


def build_subscription_content(links: list[str]) -> str:
    return base64.b64encode("\n".join(links).encode()).decode()
