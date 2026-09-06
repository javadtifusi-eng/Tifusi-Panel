from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.core import Core
from app.models.host import Host
from app.models.node import Node
from app.schemas.core import CoreCreate, CoreList, CoreResponse, CoreUpdate

router = APIRouter(prefix="/api/cores", tags=["cores"], dependencies=[Depends(get_current_admin)])


async def _to_response(core: Core, db: AsyncSession) -> CoreResponse:
    host_count = await db.scalar(select(func.count()).select_from(Host).where(Host.core_id == core.id))
    node_count = await db.scalar(select(func.count()).select_from(Node).where(Node.core_id == core.id))
    return CoreResponse(
        id=core.id,
        name=core.name,
        note=core.note,
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

    core = Core(name=payload.name, note=payload.note)
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
