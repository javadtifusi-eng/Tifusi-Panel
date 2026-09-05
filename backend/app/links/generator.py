import base64
from urllib.parse import quote, urlencode

from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser


def _fragment(remark: str) -> str:
    return quote(remark, safe="")


def build_vless_link(user: ProxyUser, host: Host) -> str:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "none"
    params: dict[str, str] = {"encryption": "none", "type": network, "security": security}

    if security == "reality":
        params["sni"] = host.sni or ""
        params["fp"] = "chrome"
        params["pbk"] = host.reality_public_key or ""
        params["sid"] = host.reality_short_id or ""
        if network == "tcp":
            params["flow"] = "xtls-rprx-vision"
    elif security == "tls" and host.sni:
        params["sni"] = host.sni

    return f"vless://{user.secret}@{host.address}:{host.port}?{urlencode(params)}#{_fragment(host.remark)}"


def build_trojan_link(user: ProxyUser, host: Host) -> str:
    network = host.network.value if host.network else "tcp"
    security = host.security.value if host.security else "tls"
    params: dict[str, str] = {"type": network, "security": security}

    if security == "reality":
        params["sni"] = host.sni or ""
        params["fp"] = "chrome"
        params["pbk"] = host.reality_public_key or ""
        params["sid"] = host.reality_short_id or ""
    elif security == "tls" and host.sni:
        params["sni"] = host.sni

    return f"trojan://{user.secret}@{host.address}:{host.port}?{urlencode(params)}#{_fragment(host.remark)}"


def build_hysteria2_link(user: ProxyUser, host: Host) -> str:
    params: dict[str, str] = {}
    if host.sni:
        params["sni"] = host.sni
    suffix = f"?{urlencode(params)}" if params else ""
    return f"hysteria2://{user.secret}@{host.address}:{host.port}{suffix}#{_fragment(host.remark)}"


# WireGuard needs a per-user keypair and an allocated tunnel IP, which nothing
# generates yet — it's excluded here rather than emitting a link that can't work.
_BUILDERS = {
    HostProtocol.vless: build_vless_link,
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
