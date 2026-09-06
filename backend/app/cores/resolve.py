from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core, CoreType


async def _resolve(core_id: int | None, db: AsyncSession, allowed: set[CoreType], label: str) -> int | None:
    if core_id is None:
        return None
    core = await db.get(Core, core_id)
    if core is None:
        raise HTTPException(status_code=400, detail="core_id not found")
    if core.core_type not in allowed:
        raise HTTPException(status_code=400, detail=f"Only an {label} core can be assigned here")
    return core_id


async def resolve_xray_core_id(core_id: int | None, db: AsyncSession) -> int | None:
    """None = no core assigned yet — a Node can sit unconfigured until the
    admin explicitly picks one (no implicit default). This is the Node's
    Xray slot specifically — its separate ipsec_core_id (see
    resolve_ipsec_core_id) is what lets the same node also run l2tp/ikev2
    at the same time, so this one stays strictly xray-only."""
    return await _resolve(core_id, db, {CoreType.xray}, "xray")


async def resolve_ipsec_core_id(core_id: int | None, db: AsyncSession) -> int | None:
    """The Node's l2tp/ikev2 slot — independent of its Xray slot, so a
    single node's agent can run Xray *and* manage strongSwan/xl2tpd at the
    same time. WireGuard stays standalone (the admin runs wg-quick
    themselves), so it's rejected here same as for the Xray slot."""
    return await _resolve(core_id, db, {CoreType.l2tp, CoreType.ikev2}, "l2tp/ikev2")
