from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core


async def resolve_core_id(core_id: int | None, db: AsyncSession) -> int | None:
    """None = no core assigned yet — a Node can sit unconfigured until the
    admin explicitly picks one (no implicit default); otherwise the id must
    resolve to a real core."""
    if core_id is None:
        return None
    exists = await db.scalar(select(Core.id).where(Core.id == core_id))
    if exists is None:
        raise HTTPException(status_code=400, detail="core_id not found")
    return core_id
