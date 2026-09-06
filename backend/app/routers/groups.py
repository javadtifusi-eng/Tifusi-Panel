from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.group import Group
from app.models.host import Host
from app.models.inbound import Inbound
from app.models.user import ProxyUser
from app.schemas.group import GroupCreate, GroupList, GroupResponse, GroupUpdate

router = APIRouter(prefix="/api/groups", tags=["groups"], dependencies=[Depends(get_current_admin)])


async def _resolve_inbounds(ids: list[int], db: AsyncSession) -> list[Inbound]:
    if not ids:
        return []
    result = await db.execute(select(Inbound).where(Inbound.id.in_(ids)))
    inbounds = list(result.scalars().all())
    if len(inbounds) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more inbound_ids not found")
    return inbounds


async def _resolve_hosts(ids: list[int], db: AsyncSession) -> list[Host]:
    if not ids:
        return []
    result = await db.execute(select(Host).where(Host.id.in_(ids)))
    hosts = list(result.scalars().all())
    if len(hosts) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more host_ids not found")
    return hosts


async def _resolve_users(ids: list[int], db: AsyncSession) -> list[ProxyUser]:
    if not ids:
        return []
    result = await db.execute(select(ProxyUser).where(ProxyUser.id.in_(ids)))
    users = list(result.scalars().all())
    if len(users) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more user_ids not found")
    return users


async def _get_group_or_404(group_id: int, db: AsyncSession) -> Group:
    group = await db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.get("", response_model=GroupList)
async def list_groups(db: AsyncSession = Depends(get_db)) -> GroupList:
    total = await db.scalar(select(func.count()).select_from(Group))
    result = await db.execute(select(Group).order_by(Group.id.desc()))
    return GroupList(total=total or 0, groups=list(result.scalars().all()))


@router.post("", response_model=GroupResponse, status_code=201)
async def create_group(payload: GroupCreate, db: AsyncSession = Depends(get_db)) -> Group:
    existing = await db.scalar(select(Group).where(Group.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A group with this name already exists")

    group = Group(name=payload.name, note=payload.note)
    # Assign the relationships before db.add(): once the object is pending in
    # an AsyncSession, setting a many-to-many collection makes SQLAlchemy try
    # to lazy-load the old value to sync the backref, which raises
    # MissingGreenlet under async — harmless on a brand-new object either way.
    group.inbounds = await _resolve_inbounds(payload.inbound_ids, db)
    group.hosts = await _resolve_hosts(payload.host_ids, db)
    group.users = await _resolve_users(payload.user_ids, db)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(group_id: int, db: AsyncSession = Depends(get_db)) -> Group:
    return await _get_group_or_404(group_id, db)


@router.put("/{group_id}", response_model=GroupResponse)
async def update_group(group_id: int, payload: GroupUpdate, db: AsyncSession = Depends(get_db)) -> Group:
    group = await _get_group_or_404(group_id, db)

    updates = payload.model_dump(exclude_unset=True, exclude={"inbound_ids", "host_ids", "user_ids"})
    for field, value in updates.items():
        setattr(group, field, value)

    if payload.inbound_ids is not None:
        group.inbounds = await _resolve_inbounds(payload.inbound_ids, db)
    if payload.host_ids is not None:
        group.hosts = await _resolve_hosts(payload.host_ids, db)
    if payload.user_ids is not None:
        group.users = await _resolve_users(payload.user_ids, db)

    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)) -> None:
    group = await _get_group_or_404(group_id, db)
    await db.delete(group)
    await db.commit()
