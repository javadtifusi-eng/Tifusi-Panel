import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.shield import ShieldEvent, ShieldGroup, ShieldMember, ShieldMode
from app.models.tunnel import Tunnel, TunnelTransport
from app.schemas.shield import (
    ShieldEventResponse,
    ShieldGroupCreate,
    ShieldGroupList,
    ShieldGroupResponse,
    ShieldGroupUpdate,
    ShieldMemberResponse,
    ShieldSwitchRequest,
)
from app.shield.cloudflare import CloudflareError, find_zone_id
from app.shield.engine import check_group, load_members, switch_to

router = APIRouter(prefix="/api/shield", tags=["shield"], dependencies=[Depends(require_permission("tunnels"))])

_EVENTS_SHOWN = 15
_RECORD_RE = re.compile(r"^(?=.{1,253}$)([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$")


def _utc(value: datetime | None) -> datetime | None:
    # SQLite hands timestamps back naive; they're UTC by convention.
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def _to_response(group: ShieldGroup, db: AsyncSession) -> ShieldGroupResponse:
    members = await load_members(group.id, db)
    events = (
        await db.execute(
            select(ShieldEvent)
            .where(ShieldEvent.group_id == group.id)
            .order_by(ShieldEvent.id.desc())
            .limit(_EVENTS_SHOWN)
        )
    ).scalars().all()
    return ShieldGroupResponse(
        id=group.id,
        name=group.name,
        enabled=group.enabled,
        mode=group.mode,
        dns_record=group.dns_record,
        has_cloudflare_token=bool(group.cloudflare_token),
        fail_threshold=group.fail_threshold,
        active_tunnel_id=group.active_tunnel_id,
        stranded=group.stranded,
        last_error=group.last_error,
        last_checked_at=_utc(group.last_checked_at),
        members=[
            ShieldMemberResponse(
                tunnel_id=t.id,
                name=t.name,
                iran_address=t.iran_address,
                iran_port=t.iran_port,
                position=m.position,
                state="burnt" if m.burnt_at is not None else "active" if t.id == group.active_tunnel_id else "standby",
                last_ok=m.last_ok,
                last_latency_ms=m.last_latency_ms,
                fail_streak=m.fail_streak,
                last_checked_at=_utc(m.last_checked_at),
                burnt_at=_utc(m.burnt_at),
            )
            for m, t in members
        ],
        events=[
            ShieldEventResponse(id=e.id, kind=e.kind, data=e.data or {}, created_at=_utc(e.created_at))
            for e in events
        ],
    )


async def _get_group_or_404(group_id: int, db: AsyncSession) -> ShieldGroup:
    group = await db.get(ShieldGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Shield group not found")
    return group


async def _validate_tunnels(tunnel_ids: list[int], group_id: int | None, db: AsyncSession) -> None:
    if len(set(tunnel_ids)) != len(tunnel_ids):
        raise HTTPException(status_code=400, detail="A relay is listed twice")
    tunnels = {t.id: t for t in (await db.execute(select(Tunnel).where(Tunnel.id.in_(tunnel_ids)))).scalars().all()}
    missing = [i for i in tunnel_ids if i not in tunnels]
    if missing:
        raise HTTPException(status_code=400, detail=f"Tunnel {missing[0]} not found")
    for t in tunnels.values():
        # A udp tunnel's KCP listener can't be probed with a TCP connect,
        # so the shield would see it as down forever.
        if t.transport is TunnelTransport.udp:
            raise HTTPException(status_code=400, detail=f"Tunnel «{t.name}» uses udp, which can't be health-checked")
    taken = (
        await db.execute(
            select(ShieldMember.tunnel_id).where(
                ShieldMember.tunnel_id.in_(tunnel_ids),
                ShieldMember.group_id != (group_id if group_id is not None else -1),
            )
        )
    ).scalars().all()
    if taken:
        raise HTTPException(status_code=400, detail=f"Tunnel «{tunnels[taken[0]].name}» already belongs to another shield group")


async def _check_dns(group: ShieldGroup) -> None:
    if group.mode != ShieldMode.dns:
        return
    if not group.dns_record or not _RECORD_RE.match(group.dns_record):
        raise HTTPException(status_code=400, detail="DNS mode needs a valid record name, e.g. relay.example.com")
    if not group.cloudflare_token:
        raise HTTPException(status_code=400, detail="DNS mode needs a Cloudflare API token")
    if not group.cloudflare_zone_id:
        # Checked now rather than at the first failover, when a typo in the
        # token would leave clients on a dead relay.
        try:
            group.cloudflare_zone_id = await find_zone_id(group.cloudflare_token, group.dns_record)
        except CloudflareError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _set_members(group: ShieldGroup, tunnel_ids: list[int], db: AsyncSession) -> None:
    existing = {m.tunnel_id: m for m in (await db.execute(select(ShieldMember).where(ShieldMember.group_id == group.id))).scalars().all()}
    for position, tunnel_id in enumerate(tunnel_ids):
        member = existing.pop(tunnel_id, None)
        if member is None:
            db.add(ShieldMember(group_id=group.id, tunnel_id=tunnel_id, position=position))
        else:
            member.position = position
    for member in existing.values():
        await db.delete(member)
    if group.active_tunnel_id not in tunnel_ids:
        group.active_tunnel_id = tunnel_ids[0]


@router.get("", response_model=ShieldGroupList)
async def list_groups(db: AsyncSession = Depends(get_db)) -> ShieldGroupList:
    groups = (await db.execute(select(ShieldGroup).order_by(ShieldGroup.id))).scalars().all()
    return ShieldGroupList(
        check_interval_seconds=settings.shield_check_interval_seconds,
        groups=[await _to_response(g, db) for g in groups],
    )


@router.post("", response_model=ShieldGroupResponse, status_code=201)
async def create_group(payload: ShieldGroupCreate, db: AsyncSession = Depends(get_db)) -> ShieldGroupResponse:
    await _validate_tunnels(payload.tunnel_ids, None, db)
    group = ShieldGroup(
        name=payload.name,
        enabled=payload.enabled,
        mode=payload.mode,
        dns_record=(payload.dns_record or "").strip().rstrip(".") or None,
        cloudflare_token=(payload.cloudflare_token or "").strip() or None,
        fail_threshold=payload.fail_threshold,
        active_tunnel_id=payload.tunnel_ids[0],
    )
    await _check_dns(group)
    db.add(group)
    await db.flush()
    await _set_members(group, payload.tunnel_ids, db)
    await db.commit()
    return await _to_response(group, db)


@router.put("/{group_id}", response_model=ShieldGroupResponse)
async def update_group(group_id: int, payload: ShieldGroupUpdate, db: AsyncSession = Depends(get_db)) -> ShieldGroupResponse:
    group = await _get_group_or_404(group_id, db)
    fields = payload.model_fields_set

    for field in ("name", "enabled", "mode", "fail_threshold"):
        if field in fields and getattr(payload, field) is not None:
            setattr(group, field, getattr(payload, field))
    if "dns_record" in fields:
        record = (payload.dns_record or "").strip().rstrip(".") or None
        if record != group.dns_record:
            group.dns_record = record
            group.cloudflare_zone_id = None
    if "cloudflare_token" in fields and payload.cloudflare_token is not None:
        group.cloudflare_token = payload.cloudflare_token.strip() or None
        group.cloudflare_zone_id = None
    await _check_dns(group)

    if "tunnel_ids" in fields and payload.tunnel_ids is not None:
        await _validate_tunnels(payload.tunnel_ids, group.id, db)
        await _set_members(group, payload.tunnel_ids, db)

    group.last_error = None
    await db.commit()
    return await _to_response(group, db)


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)) -> None:
    group = await _get_group_or_404(group_id, db)
    # Explicit rather than relying on ON DELETE CASCADE, which SQLite only
    # honours with a pragma this project doesn't turn on.
    await db.execute(delete(ShieldEvent).where(ShieldEvent.group_id == group.id))
    await db.execute(delete(ShieldMember).where(ShieldMember.group_id == group.id))
    await db.delete(group)
    await db.commit()


@router.post("/{group_id}/check", response_model=ShieldGroupResponse)
async def check_now(group_id: int, db: AsyncSession = Depends(get_db)) -> ShieldGroupResponse:
    group = await _get_group_or_404(group_id, db)
    await check_group(group, db)
    return await _to_response(group, db)


@router.post("/{group_id}/switch", response_model=ShieldGroupResponse)
async def switch_now(group_id: int, payload: ShieldSwitchRequest, db: AsyncSession = Depends(get_db)) -> ShieldGroupResponse:
    group = await _get_group_or_404(group_id, db)
    try:
        await switch_to(group, payload.tunnel_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CloudflareError as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return await _to_response(group, db)
