from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import Node, NodeStatus
from app.models.user import ProxyUser, UserStatus
from app.nodes.sync import resync_connected_nodes


async def _fetch_node_stats(node: Node) -> dict[str, dict[str, int]]:
    base_url = f"http://{node.address}:{node.port}"
    headers = {"X-Node-Api-Key": node.api_key}
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(f"{base_url}/stats", headers=headers)
        resp.raise_for_status()
        return resp.json().get("users", {})


async def collect_traffic(db: AsyncSession) -> None:
    """Pulls each connected node's traffic since the last poll — the node
    agent resets Xray's own counters after reporting them (see node_agent's
    /stats), so every number that comes back here is a fresh delta, never a
    running total, and is safe to just add onto used_traffic."""
    nodes = list((await db.execute(select(Node).where(Node.status == NodeStatus.connected))).scalars().all())
    if not nodes:
        return

    deltas: dict[str, int] = {}
    for node in nodes:
        try:
            stats = await _fetch_node_stats(node)
        except Exception:
            continue
        for username, counters in stats.items():
            deltas[username] = deltas.get(username, 0) + counters.get("uplink", 0) + counters.get("downlink", 0)

    if not deltas:
        return

    users = list((await db.execute(select(ProxyUser).where(ProxyUser.username.in_(deltas.keys())))).scalars().all())
    for user in users:
        user.used_traffic += deltas[user.username]
    await db.commit()


def _as_utc(dt: datetime) -> datetime:
    # SQLite (via aiosqlite) doesn't actually persist tzinfo, so a value
    # written as UTC-aware comes back naive on read even though the column
    # is declared DateTime(timezone=True) — every naive datetime in this
    # codebase is UTC by convention, so treat it as such rather than let
    # the aware/naive mismatch crash the comparison below.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def enforce_limits(db: AsyncSession) -> bool:
    """Auto-transitions active users past their expire date or data_limit
    into expired/limited. Only flips a status — actually dropping them from
    a running Xray config still needs a node resync, which the caller does
    when this returns True."""
    now = datetime.now(timezone.utc)
    users = list((await db.execute(select(ProxyUser).where(ProxyUser.status == UserStatus.active))).scalars().all())

    changed = False
    for user in users:
        if user.expire is not None and _as_utc(user.expire) <= now:
            user.status = UserStatus.expired
            changed = True
        elif user.data_limit and user.used_traffic >= user.data_limit:
            user.status = UserStatus.limited
            changed = True

    if changed:
        await db.commit()
    return changed


async def run_traffic_cycle(db: AsyncSession) -> None:
    await collect_traffic(db)
    if await enforce_limits(db):
        await resync_connected_nodes(db)
