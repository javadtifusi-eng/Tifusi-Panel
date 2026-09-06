from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.groups.access import hosts_for_user, resolve_groups
from app.links.generator import build_links_for_user, render_remark
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser
from app.schemas.user import ProxyUserCreate, ProxyUserList, ProxyUserResponse, ProxyUserUpdate
from app.settings_store import get_public_url
from app.wireguard.allocate import get_or_create_peer
from app.wireguard.config import build_client_config

router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    dependencies=[Depends(get_current_admin)],
)


@router.get("", response_model=ProxyUserList)
async def list_users(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> ProxyUserList:
    total = await db.scalar(select(func.count()).select_from(ProxyUser))
    result = await db.execute(
        select(ProxyUser).order_by(ProxyUser.id.desc()).offset(offset).limit(limit)
    )
    return ProxyUserList(total=total or 0, users=list(result.scalars().all()))


@router.post("", response_model=ProxyUserResponse, status_code=201)
async def create_user(
    payload: ProxyUserCreate, db: AsyncSession = Depends(get_db)
) -> ProxyUser:
    existing = await db.scalar(select(ProxyUser).where(ProxyUser.username == payload.username))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A user with this username already exists")

    user = ProxyUser(
        username=payload.username,
        data_limit=payload.data_limit,
        expire=payload.expire,
        note=payload.note,
    )
    user.groups = await resolve_groups(payload.group_ids, db) or []
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _get_user_or_404(user_id: int, db: AsyncSession) -> ProxyUser:
    user = await db.get(ProxyUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}", response_model=ProxyUserResponse)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)) -> ProxyUser:
    return await _get_user_or_404(user_id, db)


@router.put("/{user_id}", response_model=ProxyUserResponse)
async def update_user(
    user_id: int, payload: ProxyUserUpdate, db: AsyncSession = Depends(get_db)
) -> ProxyUser:
    user = await _get_user_or_404(user_id, db)

    for field, value in payload.model_dump(exclude_unset=True, exclude={"group_ids"}).items():
        setattr(user, field, value)

    new_groups = await resolve_groups(payload.group_ids, db)
    if new_groups is not None:
        user.groups = new_groups

    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db)) -> None:
    user = await _get_user_or_404(user_id, db)
    await db.delete(user)
    await db.commit()


@router.get("/{user_id}/links")
async def get_user_links(user_id: int, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    user = await _get_user_or_404(user_id, db)
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    public_url = await get_public_url(db)
    base = public_url.rstrip("/") + "/" if public_url else str(request.base_url)

    # WireGuard isn't a URI-scheme protocol like the others, so it can't join
    # the base64 link list — it gets its own field, one full .conf per host.
    wireguard_configs = []
    for host in allowed_hosts:
        if host.protocol != HostProtocol.wireguard:
            continue
        try:
            peer = await get_or_create_peer(host, user, db)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        wireguard_configs.append({"remark": render_remark(host, user), "config": build_client_config(peer, host)})

    # ikev2/l2tp have no URI scheme either — iOS/Android/strongSwan set them
    # up from plain fields (server, PSK, and for l2tp a username/password),
    # not an importable link, so each gets its own field of raw connection
    # info instead of joining the base64 link list.
    ikev2_configs = [
        {"remark": render_remark(host, user), "server": host.address, "psk": host.ikev2_psk}
        for host in allowed_hosts
        if host.protocol == HostProtocol.ikev2
    ]
    l2tp_configs = [
        {
            "remark": render_remark(host, user),
            "server": host.address,
            "psk": host.l2tp_psk,
            "username": user.username,
            "password": user.secret,
        }
        for host in allowed_hosts
        if host.protocol == HostProtocol.l2tp
    ]

    return {
        "subscription_url": f"{base}sub/{user.secret}",
        "links": build_links_for_user(user, allowed_hosts),
        "wireguard_configs": wireguard_configs,
        "ikev2_configs": ikev2_configs,
        "l2tp_configs": l2tp_configs,
    }
