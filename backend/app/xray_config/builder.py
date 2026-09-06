"""Builds the Xray config actually pushed to a node: the node's own Core's
real JSON (untouched — sniffing rules, fallbacks, custom outbounds, whatever
the admin wrote stays exactly as they wrote it), with each inbound's
`settings.clients` populated from whichever active users have group access
to that inbound's tag. Nothing is synthesized from a Host/protocol template
here anymore — the admin's own JSON is the only source of truth for how an
inbound actually runs; see app/models/inbound.py and app/cores/sync.py for
how the panel keeps its own bookkeeping in sync with it.

wireguard/hysteria2 aren't Xray inbounds and have no place in this config —
they're separate standalone servers this panel doesn't start.
"""

from copy import deepcopy

from app.groups.access import users_for_inbound
from app.models.core import Core
from app.models.inbound import Inbound
from app.models.user import ProxyUser, UserStatus

# node_agent/main.py's STATS_API_ADDR must point at this same port — it's
# how the node agent reads real per-user traffic back out of Xray (see
# app/traffic/sync.py), so the two sides have to agree on it independently.
STATS_API_PORT = 10085


def _client_for_user(inbound: Inbound, user: ProxyUser) -> dict:
    if inbound.protocol == "trojan":
        client: dict = {"password": user.secret, "email": user.username}
    elif inbound.protocol == "shadowsocks":
        client = {"password": user.secret, "email": user.username, "method": inbound.encryption}
    else:  # vless, vmess
        client = {"id": user.secret, "email": user.username}
    if inbound.protocol == "vless" and inbound.flow:
        client["flow"] = inbound.flow
    return client


def build_xray_config(core: Core, inbounds: list[Inbound], users: list[ProxyUser]) -> dict:
    config = deepcopy(core.config)
    active_users = [u for u in users if u.status == UserStatus.active]
    inbounds_by_tag = {i.tag: i for i in inbounds}

    raw_inbounds = config.setdefault("inbounds", [])
    for raw_inbound in raw_inbounds:
        inbound = inbounds_by_tag.get(raw_inbound.get("tag"))
        if inbound is None:
            continue
        allowed_users = users_for_inbound(inbound, active_users)
        raw_inbound.setdefault("settings", {})
        raw_inbound["settings"]["clients"] = [_client_for_user(inbound, u) for u in allowed_users]

    # A loopback-only inbound exposing Xray's own StatsService — this is what
    # makes real traffic accounting possible. Always present regardless of
    # what the admin's own JSON does or doesn't already define.
    if not any(i.get("tag") == "api" for i in raw_inbounds):
        raw_inbounds.insert(
            0,
            {
                "tag": "api",
                "listen": "127.0.0.1",
                "port": STATS_API_PORT,
                "protocol": "dokodemo-door",
                "settings": {"address": "127.0.0.1"},
            },
        )

    config.setdefault("log", {"loglevel": "warning"})
    config.setdefault("api", {"tag": "api", "services": ["StatsService"]})
    config.setdefault("stats", {})
    levels = config.setdefault("policy", {}).setdefault("levels", {})
    levels.setdefault("0", {"statsUserUplink": True, "statsUserDownlink": True})
    routing_rules = config.setdefault("routing", {}).setdefault("rules", [])
    if not any(r.get("outboundTag") == "api" for r in routing_rules):
        routing_rules.append({"type": "field", "inboundTag": ["api"], "outboundTag": "api"})
    outbounds = config.setdefault("outbounds", [])
    if not any(o.get("tag") == "api" for o in outbounds):
        outbounds.append({"protocol": "freedom", "tag": "api"})
    if not outbounds or not any(o.get("protocol") == "freedom" and o.get("tag") not in (None, "api") for o in outbounds):
        if not any(o.get("tag") == "direct" for o in outbounds):
            outbounds.insert(0, {"protocol": "freedom", "tag": "direct"})

    return config
