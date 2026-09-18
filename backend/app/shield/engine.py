"""Connection Shield: watches each group's Iran relays from abroad and moves
clients off one that stopped answering.

From outside Iran an Iran-access'd relay and a powered-off one look the
same — the listener just stops answering — and both call for the same
move, so the engine doesn't try to tell them apart.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.host import Host
from app.models.shield import ShieldEvent, ShieldGroup, ShieldMember, ShieldMode
from app.models.tunnel import Tunnel, TunnelStatus
from app.notifications.discord import send_discord_message
from app.notifications.telegram import send_telegram_message
from app.notifications.webhook import send_webhook_event
from app.shield.cloudflare import CloudflareError, find_zone_id, point_record
from app.tunnels.probe import ping_probe

_KEEP_EVENTS = 200
_PROBE_TIMEOUT = 4.0

Member = tuple[ShieldMember, Tunnel]


async def load_members(group_id: int, db: AsyncSession) -> list[Member]:
    rows = await db.execute(
        select(ShieldMember, Tunnel)
        .join(Tunnel, Tunnel.id == ShieldMember.tunnel_id)
        .where(ShieldMember.group_id == group_id)
        .order_by(ShieldMember.position, ShieldMember.id)
    )
    return [(m, t) for m, t in rows.all()]


def _message(group: ShieldGroup, kind: str, data: dict[str, Any]) -> str | None:
    g = group.name
    if kind == "burnt":
        return f"🛡 سپر اتصال «{g}»: رله «{data['tunnel']}» از خارج در دسترس نیست — احتمالاً ایران‌اکسس شده."
    if kind == "switched":
        if data.get("reason") == "manual":
            return f"🛡 سپر اتصال «{g}»: کاربرها به‌صورت دستی به «{data['to']}» منتقل شدند."
        if data.get("from"):
            return f"🛡 سپر اتصال «{g}»: کاربرها از «{data['from']}» به «{data['to']}» منتقل شدند."
        return f"🛡 سپر اتصال «{g}»: رله «{data['to']}» فعال شد."
    if kind == "no_spare":
        return f"⚠️ سپر اتصال «{g}»: رله جانشین سالمی نمانده. یک رله تازه به گروه اضافه کن."
    if kind == "recovered":
        return f"✅ سپر اتصال «{g}»: رله «{data['tunnel']}» دوباره در دسترس است و جانشین آماده شد."
    if kind == "error":
        return f"❌ سپر اتصال «{g}»: جابه‌جایی انجام نشد — {data['error']}"
    return None


class _Log:
    """Events are written in the same transaction as the state they
    describe; notifications only go out after that commit, so a failed
    commit never announces a switch that didn't happen."""

    def __init__(self, group: ShieldGroup, db: AsyncSession) -> None:
        self.group = group
        self.db = db
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def add(self, kind: str, **data: Any) -> None:
        self.db.add(ShieldEvent(group_id=self.group.id, kind=kind, data=data))
        self.sent.append((kind, data))

    async def commit_and_notify(self) -> None:
        if self.sent:
            await self.db.flush()
            cutoff = await self.db.scalar(
                select(ShieldEvent.id)
                .where(ShieldEvent.group_id == self.group.id)
                .order_by(ShieldEvent.id.desc())
                .offset(_KEEP_EVENTS - 1)
                .limit(1)
            )
            if cutoff is not None:
                await self.db.execute(
                    delete(ShieldEvent).where(ShieldEvent.group_id == self.group.id, ShieldEvent.id < cutoff)
                )
        await self.db.commit()
        for kind, data in self.sent:
            text = _message(self.group, kind, data)
            if text:
                await send_telegram_message(self.db, text)
                await send_discord_message(self.db, text)
            await send_webhook_event(self.db, f"shield_{kind}", {"group": self.group.name, **data})


async def _point_clients(group: ShieldGroup, members: list[Member], target: Tunnel, db: AsyncSession) -> int | None:
    """Sends the group's clients to `target`. Returns how many hosts were
    rewritten (hosts mode) or None (dns mode, where clients follow the
    record on their own)."""
    if group.mode == ShieldMode.dns:
        if not group.dns_record or not group.cloudflare_token:
            raise CloudflareError("DNS record or Cloudflare token is not set")
        if not group.cloudflare_zone_id:
            group.cloudflare_zone_id = await find_zone_id(group.cloudflare_token, group.dns_record)
        await point_record(group.cloudflare_token, group.cloudflare_zone_id, group.dns_record, target.iran_address)
        return None

    others = {t.iran_address for _, t in members if t.iran_address != target.iran_address}
    if not others:
        return 0
    result = await db.execute(update(Host).where(Host.address.in_(others)).values(address=target.iran_address))
    return result.rowcount


def _next_candidate(members: list[Member], active_id: int | None) -> Member | None:
    """The first healthy standby after the active relay in the group's
    order, wrapping around — so a group of A, B, C that loses B moves to
    C, not back to A."""
    start = next((i for i, (_, t) in enumerate(members) if t.id == active_id), -1)
    ordered = members[start + 1 :] + members[: start + 1]
    for m, t in ordered:
        if t.id != active_id and m.burnt_at is None and m.last_ok:
            return m, t
    return None


async def check_group(group: ShieldGroup, db: AsyncSession) -> None:
    members = await load_members(group.id, db)
    now = datetime.now(timezone.utc)
    group.last_checked_at = now
    log = _Log(group, db)
    if not members:
        await log.commit_and_notify()
        return

    results = await asyncio.gather(
        *(ping_probe(t.iran_address, t.iran_port, timeout=_PROBE_TIMEOUT) for _, t in members)
    )
    threshold = max(1, group.fail_threshold)
    for (m, t), (ok, latency) in zip(members, results):
        m.last_checked_at = now
        m.last_ok = ok
        m.last_latency_ms = round(latency) if latency is not None else None
        if ok:
            m.ok_streak += 1
            m.fail_streak = 0
        else:
            m.fail_streak += 1
            m.ok_streak = 0
        if m.burnt_at is not None and m.ok_streak >= threshold:
            m.burnt_at = None
            log.add("recovered", tunnel=t.name)

    active = next(((m, t) for m, t in members if t.id == group.active_tunnel_id), None)
    if active is not None and active[0].burnt_at is None and active[0].fail_streak >= threshold:
        active[0].burnt_at = now
        active[1].status = TunnelStatus.error
        active[1].last_error = "Iran side not reachable from abroad (Connection Shield)"
        active[1].last_checked_at = now
        log.add("burnt", tunnel=active[1].name)

    if active is not None and active[0].burnt_at is None:
        group.stranded = False
        await log.commit_and_notify()
        return

    candidate = _next_candidate(members, group.active_tunnel_id)
    if candidate is None:
        if not group.stranded:
            group.stranded = True
            log.add("no_spare")
        await log.commit_and_notify()
        return

    try:
        hosts = await _point_clients(group, members, candidate[1], db)
    except CloudflareError as exc:
        # Retried every cycle; announced only when the reason changes.
        if group.last_error != str(exc):
            group.last_error = str(exc)[:500]
            log.add("error", error=group.last_error)
        await log.commit_and_notify()
        return

    log.add("switched", reason="auto", to=candidate[1].name, hosts=hosts, **({"from": active[1].name} if active else {}))
    group.active_tunnel_id = candidate[1].id
    group.stranded = False
    group.last_error = None
    await log.commit_and_notify()


async def switch_to(group: ShieldGroup, tunnel_id: int, db: AsyncSession) -> None:
    """A switch the admin asked for. The target is trusted even if it's
    marked burnt — the admin may know better than three failed probes."""
    members = await load_members(group.id, db)
    target = next(((m, t) for m, t in members if t.id == tunnel_id), None)
    if target is None:
        raise ValueError("tunnel is not in this group")
    previous = next((t for _, t in members if t.id == group.active_tunnel_id), None)
    log = _Log(group, db)
    hosts = await _point_clients(group, members, target[1], db)
    target[0].burnt_at = None
    group.active_tunnel_id = target[1].id
    group.stranded = False
    group.last_error = None
    log.add("switched", reason="manual", to=target[1].name, hosts=hosts, **({"from": previous.name} if previous else {}))
    await log.commit_and_notify()


async def run_shield_cycle() -> None:
    async with async_session() as db:
        group_ids = list((await db.execute(select(ShieldGroup.id).where(ShieldGroup.enabled.is_(True)))).scalars().all())
    # A session per group: a failed group's rollback would otherwise expire
    # every other group loaded in the same session, and reloading those
    # lazily under asyncio raises instead of querying.
    for group_id in group_ids:
        async with async_session() as db:
            group = await db.get(ShieldGroup, group_id)
            if group is None:
                continue
            try:
                await check_group(group, db)
            except Exception:
                # One misconfigured group must not stop the others' failover.
                continue
