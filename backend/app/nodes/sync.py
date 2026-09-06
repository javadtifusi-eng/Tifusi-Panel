from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.access import users_for_host
from app.models.core import Core, CoreType
from app.models.host import Host
from app.models.inbound import Inbound
from app.models.node import Node, NodeStatus
from app.models.user import ProxyUser
from app.notifications.telegram import send_telegram_message
from app.xray_config.builder import build_xray_config


async def _ipsec_allowed_users(core: Core, db: AsyncSession) -> list[ProxyUser]:
    """Every ProxyUser allowed on any Host built on this l2tp Core — same
    group-access rule as everything else (a Host in no group is global)."""
    hosts = list((await db.execute(select(Host).where(Host.core_id == core.id))).scalars().all())
    users = list((await db.execute(select(ProxyUser))).scalars().all())
    allowed: dict[int, ProxyUser] = {}
    for host in hosts:
        for user in users_for_host(host, users):
            allowed[user.id] = user
    return list(allowed.values())


async def _build_xray_payload(core: Core | None, db: AsyncSession) -> dict:
    """A Node with no Xray core assigned yet gets pushed an empty config,
    same as before, since that was always the default shape."""
    if core is None:
        return {"inbounds": []}
    inbounds = list(
        (await db.execute(select(Inbound).where(Inbound.core_id == core.id))).scalars().all()
    )
    users = list((await db.execute(select(ProxyUser))).scalars().all())
    return build_xray_config(core, inbounds, users)


async def _build_ipsec_payload(core: Core, db: AsyncSession) -> dict:
    if core.core_type == CoreType.l2tp:
        users = await _ipsec_allowed_users(core, db)
        return {
            "core_type": "l2tp",
            "psk": core.l2tp_psk,
            "users": [{"username": u.username, "password": u.secret} for u in users],
        }
    # ikev2 — shared PSK only, no per-user identity in this panel's design
    return {
        "core_type": "ikev2",
        "psk": core.ikev2_psk,
        "remote_id": core.ikev2_remote_id,
    }


def _apply_health(node: Node, health: dict) -> None:
    """Shared by sync_node and check_node_health: a node counts as
    connected only if every service it's actually *assigned* reports
    running. Symmetric on both slots — a pure-ipsec node (no core_id) gets
    an empty Xray config pushed same as always, but an admin who only
    wants ipsec here shouldn't have that idle process's health gate the
    node's status, exactly like a pure-Xray node's status was never gated
    on ipsec before this feature existed."""
    xray_health = health.get("xray") or {}
    ipsec_health = health.get("ipsec") or {}
    xray_ok = node.core_id is None or xray_health.get("running", False)
    ipsec_ok = node.ipsec_core_id is None or ipsec_health.get("running", False)

    node.status = NodeStatus.connected if (xray_ok and ipsec_ok) else NodeStatus.error
    node.xray_version = xray_health.get("version")

    if xray_ok and ipsec_ok:
        node.last_error = None
    elif not xray_ok and not ipsec_ok:
        node.last_error = "xray and ipsec both reported not running"
    elif not xray_ok:
        node.last_error = "xray reported not running"
    else:
        node.last_error = "ipsec reported not running"


async def sync_node(node: Node, db: AsyncSession) -> dict:
    """Pushes the current config to one node and records what happened on
    it. Shared by the admin-triggered /sync endpoint and the periodic
    traffic job (app/traffic/sync.py), which re-syncs every connected node
    right after a status change so an expired/limited user's inbound entry
    actually disappears instead of lingering until someone clicks sync.

    A node's Xray slot (core_id) and IPsec slot (ipsec_core_id) are
    independent — the agent runs an Xray process and a strongSwan/xl2tpd
    stack at the same time, so both configs get pushed and both health
    results have to check out for the node to count as connected."""
    xray_core = await db.get(Core, node.core_id) if node.core_id is not None else None
    ipsec_core = await db.get(Core, node.ipsec_core_id) if node.ipsec_core_id is not None else None

    xray_payload = await _build_xray_payload(xray_core, db)
    ipsec_payload = await _build_ipsec_payload(ipsec_core, db) if ipsec_core is not None else None

    base_url = f"http://{node.address}:{node.port}"
    headers = {"X-Node-Api-Key": node.api_key}

    health: dict | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(f"{base_url}/config", json=xray_payload, headers=headers)
            resp.raise_for_status()
            if ipsec_payload is not None:
                ipsec_resp = await client.post(f"{base_url}/ipsec-config", json=ipsec_payload, headers=headers)
                ipsec_resp.raise_for_status()
            health_resp = await client.get(f"{base_url}/health", headers=headers)
            health_resp.raise_for_status()
            health = health_resp.json()
    except httpx.HTTPStatusError as exc:
        error = f"{exc.response.status_code}: {exc.response.text[:200]}"
    except httpx.HTTPError as exc:
        error = str(exc)[:500]

    if health is None:
        node.status = NodeStatus.error
        node.last_error = error
    else:
        _apply_health(node, health)
        node.last_synced_at = datetime.now(timezone.utc)

    await db.commit()

    # The reserved stats-API inbound (see build_xray_config) isn't one of
    # the admin's own hosts, so it's excluded from the count they see.
    inbound_count = sum(1 for inbound in xray_payload["inbounds"] if inbound.get("tag") != "api")

    return {
        "status": node.status,
        "xray_version": node.xray_version,
        "error": node.last_error,
        "inbound_count": inbound_count,
    }


async def resync_connected_nodes(db: AsyncSession) -> None:
    """Best-effort: pushes the latest config to every currently-connected
    node. Used after the periodic job changes a user's status, so removal
    from Xray isn't stuck waiting on the admin to notice and click sync."""
    nodes = list((await db.execute(select(Node).where(Node.status == NodeStatus.connected))).scalars().all())
    for node in nodes:
        try:
            await sync_node(node, db)
        except Exception:
            continue


async def check_node_health(node: Node, db: AsyncSession) -> None:
    """A read-only probe — GETs /health only, never /config — so checking on
    a node can never restart its live Xray process (sync_node's POST /config
    does that deliberately, which is exactly what a periodic background
    check must NOT do to something actively serving connections)."""
    previous_status = node.status
    base_url = f"http://{node.address}:{node.port}"
    headers = {"X-Node-Api-Key": node.api_key}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{base_url}/health", headers=headers)
            resp.raise_for_status()
            health = resp.json()
    except httpx.HTTPError as exc:
        node.status = NodeStatus.error
        node.last_error = str(exc)[:500]
        await db.commit()
        if previous_status != NodeStatus.error:
            await send_telegram_message(db, f"🔴 نود «{node.name}» از دسترس خارج شد.")
        return

    _apply_health(node, health)
    await db.commit()

    if node.status != previous_status:
        if node.status == NodeStatus.connected:
            await send_telegram_message(db, f"🟢 نود «{node.name}» دوباره متصل شد.")
        else:
            await send_telegram_message(db, f"🔴 نود «{node.name}» از دسترس خارج شد.")


async def check_all_node_health(db: AsyncSession) -> None:
    """Keeps status fresh for every node that's been synced at least once,
    without anyone having to click sync again just to find out a node went
    down (or came back). A node still 'pending' its very first sync is left
    alone — it's never had a config pushed, so /health would correctly (but
    confusingly) report "not running" there, and that's the admin's
    explicit first-sync step to take, not something to auto-flip to error."""
    nodes = list(
        (
            await db.execute(select(Node).where(Node.status.in_([NodeStatus.connected, NodeStatus.error])))
        )
        .scalars()
        .all()
    )
    for node in nodes:
        try:
            await check_node_health(node, db)
        except Exception:
            continue
