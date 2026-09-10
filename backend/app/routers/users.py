import uuid as uuid_lib

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.groups.access import hosts_for_user, resolve_groups
from app.links.generator import build_links_for_user, render_remark
from app.models.admin import Admin
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser, UserStatus
from app.models.user_device import UserDevice
from app.notifications.webhook import send_webhook_event
from app.schemas.user import (
    BulkCreateRequest,
    BulkCreateResult,
    BulkDeleteRequest,
    BulkDeleteResult,
    BulkUpdateRequest,
    BulkUpdateResult,
    ProxyUserCreate,
    ProxyUserList,
    ProxyUserResponse,
    ProxyUserUpdate,
)
from app.schemas.user_device import UserDeviceResponse
from app.settings_store import get_public_url

router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    dependencies=[Depends(require_permission("users"))],
)


def _owned_query(admin: Admin, stmt):
    """Every listing/lookup goes through this: the owner sees every user,
    a non-owner admin only ever sees ones they created. A pre-existing row
    from before admin_id existed (NULL) is nobody's — visible only to the
    owner, never silently handed to whichever admin happens to look."""
    if admin.is_owner:
        return stmt
    return stmt.where(ProxyUser.admin_id == admin.id)


@router.get("", response_model=ProxyUserList)
async def list_users(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> ProxyUserList:
    total = await db.scalar(_owned_query(admin, select(func.count()).select_from(ProxyUser)))
    result = await db.execute(
        _owned_query(admin, select(ProxyUser)).order_by(ProxyUser.id.desc()).offset(offset).limit(limit)
    )
    return ProxyUserList(total=total or 0, users=list(result.scalars().all()))


@router.post("", response_model=ProxyUserResponse, status_code=201)
async def create_user(
    payload: ProxyUserCreate,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> ProxyUser:
    existing = await db.scalar(select(ProxyUser).where(ProxyUser.username == payload.username))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A user with this username already exists")

    user = ProxyUser(
        username=payload.username,
        status=payload.status,
        # on_hold means expire doesn't start counting yet — the caller
        # shouldn't (and per validation below, can't meaningfully) also
        # hand us an absolute expire for that case.
        data_limit=payload.data_limit,
        expire=payload.expire if payload.status != UserStatus.on_hold else None,
        on_hold_expire_days=payload.on_hold_expire_days if payload.status == UserStatus.on_hold else None,
        hwid_limit=payload.hwid_limit,
        note=payload.note,
        admin_id=admin.id,
    )
    user.groups = await resolve_groups(payload.group_ids, db) or []
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await send_webhook_event(db, "user_created", {"username": user.username, "id": user.id})
    return user


@router.post("/bulk-create", response_model=BulkCreateResult, status_code=201)
async def bulk_create_users(
    payload: BulkCreateRequest,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> BulkCreateResult:
    groups = await resolve_groups(payload.group_ids, db) or []
    existing = set(
        (
            await db.scalars(
                select(ProxyUser.username).where(ProxyUser.username.in_(payload.usernames))
            )
        ).all()
    )

    created: list[ProxyUser] = []
    skipped: list[str] = []
    seen: set[str] = set()
    for username in payload.usernames:
        if username in existing or username in seen:
            skipped.append(username)
            continue
        seen.add(username)
        user = ProxyUser(
            username=username,
            data_limit=payload.data_limit,
            expire=payload.expire,
            hwid_limit=payload.hwid_limit,
            note=payload.note,
            admin_id=admin.id,
        )
        user.groups = list(groups)
        db.add(user)
        created.append(user)

    await db.commit()
    for user in created:
        await db.refresh(user)
    for user in created:
        await send_webhook_event(db, "user_created", {"username": user.username, "id": user.id})
    return BulkCreateResult(created=created, skipped=skipped)


@router.post("/bulk-update", response_model=BulkUpdateResult)
async def bulk_update_users(
    payload: BulkUpdateRequest,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> BulkUpdateResult:
    # Silently drops any id the admin doesn't own rather than erroring — the
    # same shape as asking for a page of "my users" that includes a stale
    # id: it just doesn't come back, no need to fail the whole batch over it.
    users = list(
        (
            await db.execute(_owned_query(admin, select(ProxyUser).where(ProxyUser.id.in_(payload.user_ids))))
        )
        .scalars()
        .all()
    )
    field_updates = payload.model_dump(
        exclude_unset=True, exclude={"user_ids", "add_group_ids", "remove_group_ids"}
    )
    add_groups = await resolve_groups(payload.add_group_ids, db) or []
    remove_ids = set(payload.remove_group_ids)

    for user in users:
        for field, value in field_updates.items():
            setattr(user, field, value)
        if add_groups:
            current_ids = {g.id for g in user.groups}
            user.groups = user.groups + [g for g in add_groups if g.id not in current_ids]
        if remove_ids:
            user.groups = [g for g in user.groups if g.id not in remove_ids]
        db.add(user)

    await db.commit()
    return BulkUpdateResult(updated=len(users))


@router.post("/bulk-delete", response_model=BulkDeleteResult)
async def bulk_delete_users(
    payload: BulkDeleteRequest,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> BulkDeleteResult:
    users = list(
        (
            await db.execute(_owned_query(admin, select(ProxyUser).where(ProxyUser.id.in_(payload.user_ids))))
        )
        .scalars()
        .all()
    )
    for user in users:
        await db.delete(user)
    await db.commit()
    return BulkDeleteResult(deleted=len(users))


async def _get_user_or_404(user_id: int, admin: Admin, db: AsyncSession) -> ProxyUser:
    user = await db.get(ProxyUser, user_id)
    # 404, not 403, for a user outside this admin's ownership — same
    # response as it not existing at all, so a non-owner admin can't probe
    # for ids belonging to someone else's customers.
    if user is None or (not admin.is_owner and user.admin_id != admin.id):
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}", response_model=ProxyUserResponse)
async def get_user(
    user_id: int, admin: Admin = Depends(require_permission("users")), db: AsyncSession = Depends(get_db)
) -> ProxyUser:
    return await _get_user_or_404(user_id, admin, db)


@router.put("/{user_id}", response_model=ProxyUserResponse)
async def update_user(
    user_id: int,
    payload: ProxyUserUpdate,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> ProxyUser:
    user = await _get_user_or_404(user_id, admin, db)

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
async def delete_user(
    user_id: int, admin: Admin = Depends(require_permission("users")), db: AsyncSession = Depends(get_db)
) -> None:
    user = await _get_user_or_404(user_id, admin, db)
    await db.delete(user)
    await db.commit()


@router.post("/{user_id}/reset-secret", response_model=ProxyUserResponse)
async def reset_user_secret(
    user_id: int, admin: Admin = Depends(require_permission("users")), db: AsyncSession = Depends(get_db)
) -> ProxyUser:
    """Regenerates just the secret (the VLESS UUID / Trojan password / sub
    URL token) — for when a link leaked and needs invalidating, without
    losing the rest of the user record (traffic history, note, groups) the
    way delete-and-recreate would. Every existing link/QR the user has is
    dead the instant this returns; a new one has to be reissued."""
    user = await _get_user_or_404(user_id, admin, db)
    user.secret = str(uuid_lib.uuid4())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{user_id}/devices", response_model=list[UserDeviceResponse])
async def list_user_devices(
    user_id: int, admin: Admin = Depends(require_permission("users")), db: AsyncSession = Depends(get_db)
) -> list[UserDevice]:
    await _get_user_or_404(user_id, admin, db)
    result = await db.execute(
        select(UserDevice).where(UserDevice.user_id == user_id).order_by(UserDevice.last_seen.desc())
    )
    return list(result.scalars().all())


@router.delete("/{user_id}/devices/{device_id}", status_code=204)
async def delete_user_device(
    user_id: int,
    device_id: int,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _get_user_or_404(user_id, admin, db)
    device = await db.get(UserDevice, device_id)
    if device is None or device.user_id != user_id:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()


@router.post("/{user_id}/devices/reset", status_code=204)
async def reset_user_devices(
    user_id: int, admin: Admin = Depends(require_permission("users")), db: AsyncSession = Depends(get_db)
) -> None:
    await _get_user_or_404(user_id, admin, db)
    result = await db.execute(select(UserDevice).where(UserDevice.user_id == user_id))
    for device in result.scalars().all():
        await db.delete(device)
    await db.commit()


@router.get("/{user_id}/links")
async def get_user_links(
    user_id: int,
    request: Request,
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await _get_user_or_404(user_id, admin, db)
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    public_url = await get_public_url(db)
    base = public_url.rstrip("/") + "/" if public_url else str(request.base_url)

    # ikev2/l2tp have no URI scheme either — iOS/Android/strongSwan set them
    # up from plain fields (server, PSK, and a per-user username/password
    # for EAP-MSCHAPv2/CHAP login), not an importable link, so each gets
    # its own field of raw connection info instead of joining the base64
    # link list.
    ikev2_configs = [
        {
            "remark": render_remark(host, user),
            "server": host.address,
            "psk": host.core.ikev2_psk if host.core else None,
            "username": user.username,
            "password": user.secret,
        }
        for host in allowed_hosts
        if host.protocol == HostProtocol.ikev2
    ]
    l2tp_configs = [
        {
            "remark": render_remark(host, user),
            "server": host.address,
            "psk": host.core.l2tp_psk if host.core else None,
            "username": user.username,
            "password": user.secret,
        }
        for host in allowed_hosts
        if host.protocol == HostProtocol.l2tp
    ]

    return {
        "subscription_url": f"{base}sub/{user.secret}",
        "links": build_links_for_user(user, allowed_hosts),
        "ikev2_configs": ikev2_configs,
        "l2tp_configs": l2tp_configs,
    }
