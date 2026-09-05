from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.host import Host
from app.models.node import Node, NodeStatus
from app.models.user import ProxyUser
from app.xray_config.builder import build_xray_config


async def sync_node(node: Node, db: AsyncSession) -> dict:
    """Pushes the current config to one node and records what happened on
    it. Shared by the admin-triggered /sync endpoint and the periodic
    traffic job (app/traffic/sync.py), which re-syncs every connected node
    right after a status change so an expired/limited user's inbound entry
    actually disappears instead of lingering until someone clicks sync."""
    hosts = list((await db.execute(select(Host))).scalars().all())
    users = list((await db.execute(select(ProxyUser))).scalars().all())
    config = build_xray_config(hosts, users)

    base_url = f"http://{node.address}:{node.port}"
    headers = {"X-Node-Api-Key": node.api_key}

    health: dict | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(f"{base_url}/config", json=config, headers=headers)
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
        node.last_error = None if health.get("running") else "xray reported not running"
        node.last_synced_at = datetime.now(timezone.utc)

    await db.commit()

    # The reserved stats-API inbound (see build_xray_config) isn't one of
    # the admin's own hosts, so it's excluded from the count they see.
    client_inbound_count = sum(1 for inbound in config["inbounds"] if inbound.get("tag") != "api")
    return {
        "status": node.status,
        "xray_version": node.xray_version,
        "error": node.last_error,
        "inbound_count": client_inbound_count,
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
