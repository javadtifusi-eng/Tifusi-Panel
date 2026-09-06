from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cores.resolve import resolve_core_id
from app.database import get_db
from app.dependencies import get_current_admin
from app.groups.access import resolve_groups
from app.models.host import Host, HostProtocol, HostSecurity
from app.reality.keys import generate_reality_keypair
from app.schemas.host import (
    HostCreate,
    HostList,
    HostResponse,
    HostUpdate,
    RealityKeypairResponse,
    WireGuardKeypairResponse,
)
from app.wireguard.keys import generate_wireguard_keypair

router = APIRouter(prefix="/api/hosts", tags=["hosts"], dependencies=[Depends(get_current_admin)])


def _missing_reality_fields(sni: str | None, public_key: str | None, private_key: str | None, short_id: str | None) -> list[str]:
    fields = {
        "sni": sni,
        "reality_public_key": public_key,
        "reality_private_key": private_key,
        "reality_short_id": short_id,
    }
    return [name for name, value in fields.items() if not value]


def _missing_wireguard_fields(public_key: str | None, private_key: str | None, subnet: str | None) -> list[str]:
    fields = {
        "wireguard_public_key": public_key,
        "wireguard_private_key": private_key,
        "wireguard_subnet": subnet,
    }
    return [name for name, value in fields.items() if not value]


@router.get("/reality-keypair", response_model=RealityKeypairResponse)
async def reality_keypair() -> RealityKeypairResponse:
    return RealityKeypairResponse(**generate_reality_keypair())


@router.get("/wireguard-keypair", response_model=WireGuardKeypairResponse)
async def wireguard_keypair() -> WireGuardKeypairResponse:
    return WireGuardKeypairResponse(**generate_wireguard_keypair())


@router.get("", response_model=HostList)
async def list_hosts(db: AsyncSession = Depends(get_db)) -> HostList:
    total = await db.scalar(select(func.count()).select_from(Host))
    result = await db.execute(select(Host).order_by(Host.id.desc()))
    return HostList(total=total or 0, hosts=list(result.scalars().all()))


@router.post("", response_model=HostResponse, status_code=201)
async def create_host(payload: HostCreate, db: AsyncSession = Depends(get_db)) -> Host:
    if payload.security == HostSecurity.reality:
        missing = _missing_reality_fields(
            payload.sni, payload.reality_public_key, payload.reality_private_key, payload.reality_short_id
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"REALITY requires: {', '.join(missing)}")

    if payload.protocol == HostProtocol.wireguard:
        missing = _missing_wireguard_fields(
            payload.wireguard_public_key, payload.wireguard_private_key, payload.wireguard_subnet
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"WireGuard requires: {', '.join(missing)}")

    data = payload.model_dump(exclude={"group_ids", "core_id"})
    host = Host(**data)
    host.core_id = await resolve_core_id(payload.core_id, db)
    host.groups = await resolve_groups(payload.group_ids, db) or []
    db.add(host)
    await db.commit()
    await db.refresh(host)
    return host


async def _get_host_or_404(host_id: int, db: AsyncSession) -> Host:
    host = await db.get(Host, host_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host not found")
    return host


@router.get("/{host_id}", response_model=HostResponse)
async def get_host(host_id: int, db: AsyncSession = Depends(get_db)) -> Host:
    return await _get_host_or_404(host_id, db)


@router.put("/{host_id}", response_model=HostResponse)
async def update_host(host_id: int, payload: HostUpdate, db: AsyncSession = Depends(get_db)) -> Host:
    host = await _get_host_or_404(host_id, db)
    updates = payload.model_dump(exclude_unset=True, exclude={"group_ids", "core_id"})

    merged_security = updates.get("security", host.security)
    if merged_security == HostSecurity.reality:
        missing = _missing_reality_fields(
            updates.get("sni", host.sni),
            updates.get("reality_public_key", host.reality_public_key),
            updates.get("reality_private_key", host.reality_private_key),
            updates.get("reality_short_id", host.reality_short_id),
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"REALITY requires: {', '.join(missing)}")

    if host.protocol == HostProtocol.wireguard:
        missing = _missing_wireguard_fields(
            updates.get("wireguard_public_key", host.wireguard_public_key),
            updates.get("wireguard_private_key", host.wireguard_private_key),
            updates.get("wireguard_subnet", host.wireguard_subnet),
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"WireGuard requires: {', '.join(missing)}")

    for field, value in updates.items():
        setattr(host, field, value)

    if "core_id" in payload.model_fields_set:
        host.core_id = await resolve_core_id(payload.core_id, db)

    new_groups = await resolve_groups(payload.group_ids, db)
    if new_groups is not None:
        host.groups = new_groups

    db.add(host)
    await db.commit()
    await db.refresh(host)
    return host


@router.delete("/{host_id}", status_code=204)
async def delete_host(host_id: int, db: AsyncSession = Depends(get_db)) -> None:
    host = await _get_host_or_404(host_id, db)
    await db.delete(host)
    await db.commit()
