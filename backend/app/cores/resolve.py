from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core


async def resolve_core_id(core_id: int | None, db: AsyncSession) -> int:
    """None = fall back to the default (lowest-id) core; otherwise the id must
    resolve to a real core. Used by the hosts and nodes routers so a new host
    or node always ends up assigned to some core, without the caller having
    to know which one is "default"."""
    if core_id is None:
        default_id = await db.scalar(select(Core.id).order_by(Core.id).limit(1))
        if default_id is None:
            raise HTTPException(status_code=500, detail="No core exists")
        return default_id
    exists = await db.scalar(select(Core.id).where(Core.id == core_id))
    if exists is None:
        raise HTTPException(status_code=400, detail="core_id not found")
    return core_id
