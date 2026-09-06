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


async def _build_payload(node: Node, core: Core | None, db: AsyncSession) -> tuple[str, dict]:
    """Returns (agent_endpoint, json_body) for whatever this node's core
    actually is — a Node with no core assigned yet gets pushed an empty
    Xray config, same as before, since that was always the default shape."""
    if core is None or core.core_type == CoreType.xray:
        if core is None:
            config = {"inbounds": []}
        else:
            inbounds = list(
                (await db.execute(select(Inbound).where(Inbound.core_id == core.id))).scalars().all()
            )
            users = list((await db.execute(select(ProxyUser))).scalars().all())
            config = build_xray_config(core, inbounds, users)
        return "/config", config

    if core.core_type == CoreType.l2tp:
        users = await _ipsec_allowed_users(core, db)
        return "/ipsec-config", {
            "core_type": "l2tp",
            "psk": core.l2tp_psk,
            "users": [{"username": u.username, "password": u.secret} for u in users],
        }

    # ikev2 — shared PSK only, no per-user identity in this panel's design
    return "/ipsec-config", {
        "core_type": "ikev2",
        "psk": core.ikev2_psk,
        "remote_id": core.ikev2_remote_id,
    }


async def sync_node(node: Node, db: AsyncSession) -> dict:
    """Pushes the current config to one node and records what happened on
    it. Shared by the admin-triggered /sync endpoint and the periodic
    traffic job (app/traffic/sync.py), which re-syncs every connected node
    right after a status change so an expired/limited user's inbound entry
    actually disappears instead of lingering until someone clicks sync."""
    core = await db.get(Core, node.core_id) if node.core_id is not None else None
    endpoint, payload = await _build_payload(node, core, db)

    base_url = f"http://{node.address}:{node.port}"
    headers = {"X-Node-Api-Key": node.api_key}

    health: dict | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(f"{base_url}{endpoint}", json=payload, headers=headers)
            resp.raise_for_status()
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
        node.status = NodeStatus.connected if health.get("running") else NodeStatus.error
        node.xray_version = health.get("xray_version")
        node.last_error = None if health.get("running") else f"{payload.get('core_type', 'xray')} reported not running"
        node.last_synced_at = datetime.now(timezone.utc)

    await db.commit()

    if endpoint == "/config":
        # The reserved stats-API inbound (see build_xray_config) isn't one of
        # the admin's own hosts, so it's excluded from the count they see.
        inbound_count = sum(1 for inbound in payload["inbounds"] if inbound.get("tag") != "api")
    else:
        inbound_count = len(payload.get("users", [])) if payload["core_type"] == "l2tp" else (1 if core else 0)

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

    node.status = NodeStatus.connected if health.get("running") else NodeStatus.error
    node.xray_version = health.get("xray_version")
    node.last_error = None if health.get("running") else "xray reported not running"
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
