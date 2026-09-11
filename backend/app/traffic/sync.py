from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import Node, NodeStatus
from app.models.node_traffic_snapshot import NodeTrafficSnapshot
from app.models.traffic_snapshot import TrafficSnapshot
from app.models.user import ProxyUser, UserStatus
from app.nodes.sync import check_all_node_health, resync_connected_nodes
from app.notifications.discord import send_discord_message
from app.notifications.telegram import send_telegram_message
from app.notifications.webhook import send_webhook_event


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
    node_deltas: dict[int, int] = {}
    for node in nodes:
        try:
            stats = await _fetch_node_stats(node)
        except Exception:
            continue
        for username, counters in stats.items():
            delta = counters.get("uplink", 0) + counters.get("downlink", 0)
            deltas[username] = deltas.get(username, 0) + delta
            node_deltas[node.id] = node_deltas.get(node.id, 0) + delta

    if not deltas:
        return

    users = list((await db.execute(select(ProxyUser).where(ProxyUser.username.in_(deltas.keys())))).scalars().all())
    for user in users:
        user.used_traffic += deltas[user.username]

    today = datetime.now(timezone.utc).date()
    snapshot = await db.scalar(select(TrafficSnapshot).where(TrafficSnapshot.date == today))
    if snapshot is None:
        snapshot = TrafficSnapshot(date=today, total_bytes=0)
        db.add(snapshot)
    snapshot.total_bytes += sum(deltas.values())

    for node_id, node_total in node_deltas.items():
        if not node_total:
            continue
        node_snapshot = await db.scalar(
            select(NodeTrafficSnapshot).where(
                NodeTrafficSnapshot.node_id == node_id, NodeTrafficSnapshot.date == today
            )
        )
        if node_snapshot is None:
            node_snapshot = NodeTrafficSnapshot(node_id=node_id, date=today, total_bytes=0)
            db.add(node_snapshot)
        node_snapshot.total_bytes += node_total

    await db.commit()


def _as_utc(dt: datetime) -> datetime:
    # SQLite (via aiosqlite) doesn't actually persist tzinfo, so a value
    # written as UTC-aware comes back naive on read even though the column
    # is declared DateTime(timezone=True) — every naive datetime in this
    # codebase is UTC by convention, so treat it as such rather than let
    # the aware/naive mismatch crash the comparison below.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def _apply_periodic_resets(db: AsyncSession, now: datetime) -> bool:
    """Zeroes used_traffic back to 0 (and reactivates a user `limited` by
    hitting data_limit) every data_limit_reset_days, for every user that
    opted into a recurring cap instead of a one-time one. Runs before the
    one-time enforce_limits pass below so a user due for a reset this
    exact cycle never gets flipped to `limited` first and reset a moment
    later — same cycle, reset wins.
    """
    candidates = list(
        (
            await db.execute(
                select(ProxyUser).where(
                    ProxyUser.data_limit_reset_days.isnot(None),
                    ProxyUser.status.in_((UserStatus.active, UserStatus.limited)),
                )
            )
        )
        .scalars()
        .all()
    )

    changed = False
    for user in candidates:
        if not user.data_limit_reset_days:
            continue
        anchor = _as_utc(user.data_limit_reset_at) if user.data_limit_reset_at else _as_utc(user.created_at)
        interval = timedelta(days=user.data_limit_reset_days)
        if interval <= timedelta(0) or now < anchor + interval:
            continue
        # Advance by whole intervals from the original anchor rather than
        # snapping to `now` — a cycle that ran late (node down, panel
        # restarted) still lands back on the user's original schedule
        # instead of quietly pushing every future reset later too.
        periods_elapsed = (now - anchor) // interval
        user.data_limit_reset_at = anchor + interval * periods_elapsed
        user.used_traffic = 0
        if user.status == UserStatus.limited:
            user.status = UserStatus.active
        changed = True

    return changed


async def enforce_limits(db: AsyncSession) -> bool:
    """Auto-transitions active users past their expire date or data_limit
    into expired/limited. Only flips a status — actually dropping them from
    a running Xray config still needs a node resync, which the caller does
    when this returns True."""
    now = datetime.now(timezone.utc)
    reset_changed = await _apply_periodic_resets(db, now)
    users = list((await db.execute(select(ProxyUser).where(ProxyUser.status == UserStatus.active))).scalars().all())

    changed = reset_changed
    notifications: list[str] = []
    events: list[tuple[str, dict]] = []
    for user in users:
        if user.expire is not None and _as_utc(user.expire) <= now:
            user.status = UserStatus.expired
            changed = True
            notifications.append(f"⏰ کاربر «{user.username}» منقضی شد.")
            events.append(("user_expired", {"username": user.username, "expire": user.expire.isoformat()}))
        elif user.data_limit and user.used_traffic >= user.data_limit:
            user.status = UserStatus.limited
            changed = True
            notifications.append(f"📊 کاربر «{user.username}» به سقف حجم مصرفی‌اش رسید.")
            events.append(
                ("user_limited", {"username": user.username, "data_limit": user.data_limit, "used_traffic": user.used_traffic})
            )

    if changed:
        await db.commit()
        for text in notifications:
            await send_telegram_message(db, text)
            await send_discord_message(db, text)
        for event, payload in events:
            await send_webhook_event(db, event, payload)
    return changed


async def run_traffic_cycle(db: AsyncSession) -> None:
    # Health first: a node that died since the last cycle should drop out of
    # collect_traffic's "connected" query instead of failing it silently,
    # and one that recovered should start counting again right away.
    await check_all_node_health(db)
    await collect_traffic(db)
    if await enforce_limits(db):
        await resync_connected_nodes(db)
