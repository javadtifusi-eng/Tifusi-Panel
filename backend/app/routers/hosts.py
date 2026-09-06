from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.groups.access import resolve_groups
from app.models.host import XRAY_PROTOCOLS, Host, HostProtocol
from app.models.inbound import Inbound
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


def _missing(**fields: object) -> list[str]:
    return [name for name, value in fields.items() if not value]


async def _validate(protocol: HostProtocol, get, db: AsyncSession) -> None:
    """`get(field)` returns the value that would end up on the Host after
    this create/update — the merged value for updates, the payload value
    for creates. Raises 400 with exactly what's missing."""
    if protocol in XRAY_PROTOCOLS:
        inbound_id = get("inbound_id")
        missing = _missing(inbound_id=inbound_id)
        if missing:
            raise HTTPException(status_code=400, detail=f"{protocol.value} requires: {', '.join(missing)}")
        inbound = await db.get(Inbound, inbound_id)
        if inbound is None:
            raise HTTPException(status_code=400, detail="inbound_id not found")
        if inbound.protocol != protocol.value:
            raise HTTPException(
                status_code=400,
                detail=f"inbound '{inbound.tag}' is {inbound.protocol}, not {protocol.value}",
            )
    elif protocol == HostProtocol.wireguard:
        missing = _missing(
            wireguard_public_key=get("wireguard_public_key"),
            wireguard_private_key=get("wireguard_private_key"),
            wireguard_subnet=get("wireguard_subnet"),
            wireguard_port=get("wireguard_port"),
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"wireguard requires: {', '.join(missing)}")
    elif protocol == HostProtocol.hysteria2:
        missing = _missing(hysteria2_sni=get("hysteria2_sni"), hysteria2_port=get("hysteria2_port"))
        if missing:
            raise HTTPException(status_code=400, detail=f"hysteria2 requires: {', '.join(missing)}")
    elif protocol == HostProtocol.ikev2:
        missing = _missing(ikev2_psk=get("ikev2_psk"))
        if missing:
            raise HTTPException(status_code=400, detail=f"ikev2 requires: {', '.join(missing)}")
    elif protocol == HostProtocol.l2tp:
        missing = _missing(l2tp_psk=get("l2tp_psk"))
        if missing:
            raise HTTPException(status_code=400, detail=f"l2tp requires: {', '.join(missing)}")


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
    data = payload.model_dump()
    await _validate(payload.protocol, data.get, db)

    host = Host(**payload.model_dump(exclude={"group_ids"}))
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
    updates = payload.model_dump(exclude_unset=True, exclude={"group_ids"})

    def get(field: str):
        return updates.get(field, getattr(host, field))

    await _validate(host.protocol, get, db)

    for field, value in updates.items():
        setattr(host, field, value)

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
