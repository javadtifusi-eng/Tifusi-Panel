from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core, CoreType


_NODE_MANAGED_TYPES = {CoreType.xray, CoreType.l2tp, CoreType.ikev2}


async def resolve_core_id(core_id: int | None, db: AsyncSession) -> int | None:
    """None = no core assigned yet — a Node can sit unconfigured until the
    admin explicitly picks one (no implicit default); otherwise the id must
    resolve to a real core. A Node's agent can run Xray, or manage a real
    strongSwan/xl2tpd install for l2tp/ikev2 — wireguard stays standalone
    (the admin runs wg-quick themselves), so it's the one type still
    rejected here."""
    if core_id is None:
        return None
    core = await db.get(Core, core_id)
    if core is None:
        raise HTTPException(status_code=400, detail="core_id not found")
    if core.core_type not in _NODE_MANAGED_TYPES:
        raise HTTPException(status_code=400, detail="This core type can't be assigned to a node")
    return core_id
