from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.core import Core
from app.models.host import Host, HostProtocol, HostSecurity
from app.models.node import Node
from app.schemas.core import CoreCreate, CoreList, CoreResponse, CoreUpdate

router = APIRouter(prefix="/api/cores", tags=["cores"], dependencies=[Depends(get_current_admin)])

_TRANSPORT_PROTOCOLS = {HostProtocol.vless, HostProtocol.vmess, HostProtocol.trojan}


def _missing(**fields: str | None) -> list[str]:
    return [name for name, value in fields.items() if not value]


def _validate(protocol: HostProtocol, network, security, get) -> None:
    """`get(field)` returns the value that would end up on the Core after
    this create/update — the merged value for updates, the payload value
    for creates. Raises 400 with exactly what's missing."""
    if protocol in _TRANSPORT_PROTOCOLS:
        if network is None:
            raise HTTPException(status_code=400, detail="network is required for this protocol")
        if security is None:
            raise HTTPException(status_code=400, detail="security is required for this protocol")
        if security == HostSecurity.reality:
            missing = _missing(
                sni=get("sni"),
                reality_public_key=get("reality_public_key"),
                reality_private_key=get("reality_private_key"),
                reality_short_id=get("reality_short_id"),
            )
            if missing:
                raise HTTPException(status_code=400, detail=f"REALITY requires: {', '.join(missing)}")
    elif protocol == HostProtocol.wireguard:
        missing = _missing(
            wireguard_public_key=get("wireguard_public_key"),
            wireguard_private_key=get("wireguard_private_key"),
            wireguard_subnet=get("wireguard_subnet"),
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"WireGuard requires: {', '.join(missing)}")


async def _to_response(core: Core, db: AsyncSession) -> CoreResponse:
    host_count = await db.scalar(select(func.count()).select_from(Host).where(Host.core_id == core.id))
    node_count = await db.scalar(select(func.count()).select_from(Node).where(Node.core_id == core.id))
    return CoreResponse(
        id=core.id,
        name=core.name,
        note=core.note,
        protocol=core.protocol,
        network=core.network,
        security=core.security,
        default_port=core.default_port,
        sni=core.sni,
        fingerprint=core.fingerprint,
        alpn=core.alpn,
        path=core.path,
        host_header=core.host_header,
        reality_public_key=core.reality_public_key,
        reality_private_key=core.reality_private_key,
        reality_short_id=core.reality_short_id,
        wireguard_public_key=core.wireguard_public_key,
        wireguard_private_key=core.wireguard_private_key,
        wireguard_subnet=core.wireguard_subnet,
        created_at=core.created_at,
        host_count=host_count or 0,
        node_count=node_count or 0,
    )


async def _get_core_or_404(core_id: int, db: AsyncSession) -> Core:
    core = await db.get(Core, core_id)
    if core is None:
        raise HTTPException(status_code=404, detail="Core not found")
    return core


@router.get("", response_model=CoreList)
async def list_cores(db: AsyncSession = Depends(get_db)) -> CoreList:
    total = await db.scalar(select(func.count()).select_from(Core))
    result = await db.execute(select(Core).order_by(Core.id))
    cores = list(result.scalars().all())
    return CoreList(total=total or 0, cores=[await _to_response(c, db) for c in cores])


@router.post("", response_model=CoreResponse, status_code=201)
async def create_core(payload: CoreCreate, db: AsyncSession = Depends(get_db)) -> CoreResponse:
    existing = await db.scalar(select(Core).where(Core.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A core with this name already exists")

    data = payload.model_dump()
    _validate(payload.protocol, payload.network, payload.security, data.get)

    core = Core(**data)
    db.add(core)
    await db.commit()
    await db.refresh(core)
    return await _to_response(core, db)


@router.put("/{core_id}", response_model=CoreResponse)
async def update_core(core_id: int, payload: CoreUpdate, db: AsyncSession = Depends(get_db)) -> CoreResponse:
    core = await _get_core_or_404(core_id, db)
    updates = payload.model_dump(exclude_unset=True)

    if "name" in updates:
        existing = await db.scalar(select(Core).where(Core.name == updates["name"], Core.id != core_id))
        if existing is not None:
            raise HTTPException(status_code=409, detail="A core with this name already exists")

    merged_protocol = updates.get("protocol", core.protocol)
    merged_network = updates.get("network", core.network)
    merged_security = updates.get("security", core.security)

    def get(field: str):
        return updates.get(field, getattr(core, field))

    _validate(merged_protocol, merged_network, merged_security, get)

    for field, value in updates.items():
        setattr(core, field, value)

    db.add(core)
    await db.commit()
    await db.refresh(core)
    return await _to_response(core, db)


@router.delete("/{core_id}", status_code=204)
async def delete_core(core_id: int, db: AsyncSession = Depends(get_db)) -> None:
    await _get_core_or_404(core_id, db)

    total_cores = await db.scalar(select(func.count()).select_from(Core))
    if (total_cores or 0) <= 1:
        raise HTTPException(status_code=400, detail="Can't delete the only remaining core")

    host_count = await db.scalar(select(func.count()).select_from(Host).where(Host.core_id == core_id))
    node_count = await db.scalar(select(func.count()).select_from(Node).where(Node.core_id == core_id))
    if (host_count or 0) + (node_count or 0) > 0:
        raise HTTPException(status_code=400, detail="Core is still in use by hosts or nodes")

    core = await _get_core_or_404(core_id, db)
    await db.delete(core)
    await db.commit()
