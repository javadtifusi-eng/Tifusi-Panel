from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.models.api_key import ApiKey
from app.models.user import ProxyUser
from app.nodes.sync import resync_nodes_in_background
from app.resellers import protocol_catalog
from app.schemas.reseller import ProtocolOption, ResellerCreate, ResellerItem, ResellerList, ResellerUpdate
from app.security import hash_password

router = APIRouter(prefix="/api/resellers", tags=["resellers"])


async def _owner(admin: Admin = Depends(get_current_admin)) -> Admin:
    if not admin.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner admin can manage resellers")
    return admin


async def _usage_by_admin(db: AsyncSession) -> dict[int, tuple[int, int, int]]:
    rows = await db.execute(
        select(
            ProxyUser.admin_id,
            func.count(ProxyUser.id),
            func.coalesce(func.sum(ProxyUser.data_limit), 0),
            func.coalesce(func.sum(ProxyUser.used_traffic), 0),
        ).group_by(ProxyUser.admin_id)
    )
    return {admin_id: (int(c), int(d), int(u)) for admin_id, c, d, u in rows.all() if admin_id is not None}


def _item(reseller: Admin, usage: dict[int, tuple[int, int, int]]) -> ResellerItem:
    users_count, allocated, used = usage.get(reseller.id, (0, 0, 0))
    return ResellerItem(
        id=reseller.id,
        username=reseller.username,
        disabled=reseller.disabled,
        max_users=reseller.max_users,
        data_quota=reseller.data_quota,
        protocols=reseller.protocols or [],
        users_count=users_count,
        data_allocated=allocated,
        used_traffic=used,
        created_at=reseller.created_at,
    )


async def _get_reseller(reseller_id: int, db: AsyncSession) -> Admin:
    reseller = await db.get(Admin, reseller_id)
    if reseller is None or not reseller.is_reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")
    return reseller


@router.get("", response_model=ResellerList)
async def list_resellers(_: Admin = Depends(_owner), db: AsyncSession = Depends(get_db)) -> ResellerList:
    resellers = (await db.execute(select(Admin).where(Admin.is_reseller.is_(True)).order_by(Admin.id))).scalars().all()
    usage = await _usage_by_admin(db)
    return ResellerList(
        resellers=[_item(r, usage) for r in resellers],
        protocols=[ProtocolOption(**p) for p in await protocol_catalog(db)],
    )


@router.post("", response_model=ResellerItem, status_code=201)
async def create_reseller(
    payload: ResellerCreate, _: Admin = Depends(_owner), db: AsyncSession = Depends(get_db)
) -> ResellerItem:
    existing = await db.scalar(select(Admin).where(Admin.username == payload.username))
    if existing is not None:
        raise HTTPException(status_code=409, detail="An admin or reseller with this username already exists")

    reseller = Admin(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        is_owner=False,
        is_reseller=True,
        # Every other router is closed to it; see app/resellers.py for what
        # still narrows it inside /api/users.
        permissions=["users"],
        max_users=payload.max_users,
        data_quota=payload.data_quota,
        protocols=payload.protocols,
    )
    db.add(reseller)
    await db.commit()
    await db.refresh(reseller)
    return _item(reseller, {})


@router.put("/{reseller_id}", response_model=ResellerItem)
async def update_reseller(
    reseller_id: int,
    payload: ResellerUpdate,
    background_tasks: BackgroundTasks,
    _: Admin = Depends(_owner),
    db: AsyncSession = Depends(get_db),
) -> ResellerItem:
    reseller = await _get_reseller(reseller_id, db)
    fields = payload.model_fields_set

    if "max_users" in fields:
        reseller.max_users = payload.max_users
    if "data_quota" in fields:
        reseller.data_quota = payload.data_quota
    if payload.password:
        reseller.hashed_password = hash_password(payload.password)
        reseller.token_version = (reseller.token_version or 0) + 1
    if payload.disabled is not None and payload.disabled != reseller.disabled:
        reseller.disabled = payload.disabled
        if payload.disabled:
            # Signs it out everywhere right away, not at its token's expiry.
            reseller.token_version = (reseller.token_version or 0) + 1
    if payload.protocols is not None and payload.protocols != reseller.protocols:
        reseller.protocols = payload.protocols
        # A protocol taken away is taken from every user of this reseller too;
        # a user left with none falls back to everything still allowed.
        users = (await db.execute(select(ProxyUser).where(ProxyUser.admin_id == reseller.id))).scalars().all()
        for user in users:
            kept = [p for p in (user.protocols or []) if p in payload.protocols]
            user.protocols = kept or list(payload.protocols)
        background_tasks.add_task(resync_nodes_in_background)

    db.add(reseller)
    await db.commit()
    await db.refresh(reseller)
    return _item(reseller, await _usage_by_admin(db))


@router.delete("/{reseller_id}", status_code=204)
async def delete_reseller(reseller_id: int, _: Admin = Depends(_owner), db: AsyncSession = Depends(get_db)) -> None:
    reseller = await _get_reseller(reseller_id, db)
    # The users keep working and pass to the owner, the only admin who can
    # see a user without one.
    await db.execute(update(ProxyUser).where(ProxyUser.admin_id == reseller.id).values(admin_id=None))
    await db.execute(delete(ApiKey).where(ApiKey.admin_id == reseller.id))
    await db.delete(reseller)
    await db.commit()
