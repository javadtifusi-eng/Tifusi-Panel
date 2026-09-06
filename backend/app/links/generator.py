import base64
import json
from datetime import datetime, timezone
from urllib.parse import quote, urlencode

from app.models.host import Host, HostProtocol
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


def _transport_params(host: Host) -> dict[str, str]:
    """path/serviceName + Host header — same shape for every URI-scheme protocol."""
    network = host.network.value if host.network else "tcp"
    params: dict[str, str] = {}
    if network == "ws":
        if host.path:
            params["path"] = host.path
        if host.host_header:
            params["host"] = host.host_header
    elif network == "grpc":
        if host.path:
            params["serviceName"] = host.path
    return params


def build_vless_link(user: ProxyUser, host: Host) -> str:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "none"
    params: dict[str, str] = {"encryption": "none", "type": network, "security": security}
    params.update(_transport_params(host))

    if security == "reality":
        params["sni"] = host.effective_sni or ""
        if host.fingerprint:
            params["fp"] = host.fingerprint
        params["pbk"] = host.reality_public_key or ""
        params["sid"] = host.reality_short_id or ""
        if network == "tcp":
            params["flow"] = "xtls-rprx-vision"
    elif security == "tls":
        if host.effective_sni:
            params["sni"] = host.effective_sni
        if host.fingerprint:
            params["fp"] = host.fingerprint
        if host.effective_alpn:
            params["alpn"] = host.effective_alpn

    return f"vless://{user.secret}@{host.address}:{host.effective_port}?{urlencode(params)}#{_fragment(render_remark(host, user))}"


def build_vmess_link(user: ProxyUser, host: Host) -> str:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "none"
    obj = {
        "v": "2",
        "ps": render_remark(host, user),
        "add": host.address,
        "port": str(host.effective_port),
        "id": user.secret,
        "aid": "0",
        "scy": "auto",
        "net": network,
        "type": "none",
        "host": host.host_header or "",
        "path": host.path or "",
        "tls": "tls" if security == "tls" else "",
        "sni": host.effective_sni or "",
        "alpn": host.effective_alpn or "",
        "fp": host.fingerprint or "",
    }
    encoded = base64.b64encode(json.dumps(obj).encode()).decode()
    return f"vmess://{encoded}"


def build_trojan_link(user: ProxyUser, host: Host) -> str:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "tls"
    params: dict[str, str] = {"type": network, "security": security}
    params.update(_transport_params(host))

    if security == "reality":
        params["sni"] = host.effective_sni or ""
        if host.fingerprint:
            params["fp"] = host.fingerprint
        params["pbk"] = host.reality_public_key or ""
        params["sid"] = host.reality_short_id or ""
    elif security == "tls":
        if host.effective_sni:
            params["sni"] = host.effective_sni
        if host.fingerprint:
            params["fp"] = host.fingerprint
        if host.effective_alpn:
            params["alpn"] = host.effective_alpn

    return f"trojan://{user.secret}@{host.address}:{host.effective_port}?{urlencode(params)}#{_fragment(render_remark(host, user))}"


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
    HostProtocol.hysteria2: build_hysteria2_link,
}


def build_links_for_user(user: ProxyUser, hosts: list[Host]) -> list[str]:
    links = []
    for host in hosts:
        builder = _BUILDERS.get(host.protocol)
        if builder is not None:
            links.append(builder(user, host))
    return links


def build_subscription_content(links: list[str]) -> str:
    return base64.b64encode("\n".join(links).encode()).decode()
