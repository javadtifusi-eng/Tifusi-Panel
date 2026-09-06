from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core, CoreType


async def resolve_core_id(core_id: int | None, db: AsyncSession) -> int | None:
    """None = no core assigned yet — a Node can sit unconfigured until the
    admin explicitly picks one (no implicit default); otherwise the id must
    resolve to a real core. A Node only ever runs Xray-core, so only an
    xray-type Core can be assigned to one — wireguard/l2tp/ikev2 cores are
    standalone servers this panel never pushes a config to."""
    if core_id is None:
        return None
    core = await db.get(Core, core_id)
    if core is None:
        raise HTTPException(status_code=400, detail="core_id not found")
    if core.core_type != CoreType.xray:
        raise HTTPException(status_code=400, detail="Only an xray core can be assigned to a node")
    return core_id
