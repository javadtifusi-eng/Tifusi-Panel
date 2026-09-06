from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cores.sync import sync_inbounds
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.core import Core
from app.models.host import Host
from app.models.inbound import Inbound
from app.models.node import Node
from app.schemas.core import CoreCreate, CoreList, CoreResponse, CoreUpdate, InboundResponse

router = APIRouter(prefix="/api/cores", tags=["cores"], dependencies=[Depends(get_current_admin)])


async def _to_response(core: Core, db: AsyncSession, warnings: list[str] | None = None) -> CoreResponse:
    node_count = await db.scalar(select(func.count()).select_from(Node).where(Node.core_id == core.id))
    inbound_responses = []
    for inbound in core.inbounds:
        host_count = await db.scalar(
            select(func.count()).select_from(Host).where(Host.inbound_id == inbound.id)
        )
        inbound_responses.append(
            InboundResponse(
                id=inbound.id,
                tag=inbound.tag,
                protocol=inbound.protocol,
                network=inbound.network,
                security=inbound.security,
                port=inbound.port,
                encryption=inbound.encryption,
                flow=inbound.flow,
                header_type=inbound.header_type,
                path=inbound.path,
                host_header=inbound.host_header,
                sni=inbound.sni,
                alpn=inbound.alpn,
                fingerprint=inbound.fingerprint,
                reality_public_key=inbound.reality_public_key,
                reality_short_id=inbound.reality_short_id,
                host_count=host_count or 0,
                group_ids=inbound.group_ids,
            )
        )
    return CoreResponse(
        id=core.id,
        name=core.name,
        note=core.note,
        config=core.config,
        created_at=core.created_at,
        inbounds=inbound_responses,
        node_count=node_count or 0,
        warnings=warnings or [],
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


@router.get("/{core_id}", response_model=CoreResponse)
async def get_core(core_id: int, db: AsyncSession = Depends(get_db)) -> CoreResponse:
    core = await _get_core_or_404(core_id, db)
    return await _to_response(core, db)


@router.post("", response_model=CoreResponse, status_code=201)
async def create_core(payload: CoreCreate, db: AsyncSession = Depends(get_db)) -> CoreResponse:
    existing = await db.scalar(select(Core).where(Core.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A core with this name already exists")

    core = Core(name=payload.name, note=payload.note, config=payload.config)
    core.inbounds = []  # avoids a lazy-load attempt on the brand-new object below
    db.add(core)
    await db.flush()
    warnings = await sync_inbounds(core, db)
    await db.commit()
    await db.refresh(core)
    return await _to_response(core, db, warnings)


@router.put("/{core_id}", response_model=CoreResponse)
async def update_core(core_id: int, payload: CoreUpdate, db: AsyncSession = Depends(get_db)) -> CoreResponse:
    core = await _get_core_or_404(core_id, db)
    updates = payload.model_dump(exclude_unset=True)

    if "name" in updates:
        existing = await db.scalar(select(Core).where(Core.name == updates["name"], Core.id != core_id))
        if existing is not None:
            raise HTTPException(status_code=409, detail="A core with this name already exists")
        core.name = updates["name"]
    if "note" in updates:
        core.note = updates["note"]

    warnings: list[str] = []
    if "config" in updates:
        core.config = updates["config"]
        warnings = await sync_inbounds(core, db)

    db.add(core)
    await db.commit()
    await db.refresh(core)
    return await _to_response(core, db, warnings)


@router.delete("/{core_id}", status_code=204)
async def delete_core(core_id: int, db: AsyncSession = Depends(get_db)) -> None:
    core = await _get_core_or_404(core_id, db)

    node_count = await db.scalar(select(func.count()).select_from(Node).where(Node.core_id == core_id))
    host_count = await db.scalar(
        select(func.count())
        .select_from(Host)
        .join(Inbound, Host.inbound_id == Inbound.id)
        .where(Inbound.core_id == core_id)
    )
    if (host_count or 0) + (node_count or 0) > 0:
        raise HTTPException(status_code=400, detail="Core is still in use by hosts or nodes")

    await db.delete(core)
    await db.commit()
