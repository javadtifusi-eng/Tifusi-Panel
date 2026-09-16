from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.resellers import protocol_catalog, reseller_usage
from app.schemas.admin import (
    AdminCreate,
    AdminList,
    AdminListItem,
    AdminPermissionsUpdate,
    AdminProfileResponse,
    AvatarUpdate,
    ChangePasswordRequest,
)
from app.schemas.reseller import ProtocolOption, ResellerQuota
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_owner(admin: Admin) -> None:
    if not admin.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner admin can manage other admins")


@router.get("/me", response_model=AdminProfileResponse)
async def get_me(
    admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> AdminProfileResponse:
    reseller = None
    if admin.is_reseller:
        users_count, allocated, used = await reseller_usage(admin.id, db)
        reseller = ResellerQuota(
            max_users=admin.max_users,
            users_count=users_count,
            data_quota=admin.data_quota,
            data_allocated=allocated,
            used_traffic=used,
            protocols=[ProtocolOption(**p) for p in await protocol_catalog(db, only=admin.protocols or [])],
        )
    return AdminProfileResponse(
        username=admin.username,
        is_owner=admin.is_owner,
        permissions=admin.permissions,
        is_reseller=admin.is_reseller,
        reseller=reseller,
        avatar=admin.avatar,
    )


@router.put("/me/avatar", status_code=204)
async def update_avatar(
    payload: AvatarUpdate,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    admin.avatar = payload.avatar
    db.add(admin)
    await db.commit()


@router.put("/password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not verify_password(payload.current_password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    admin.hashed_password = hash_password(payload.new_password)
    # Invalidates every token issued before this — including the one used
    # to make this very request, so the frontend has to log back in with
    # the new password right after. See app/dependencies.get_current_admin.
    admin.token_version = (admin.token_version or 0) + 1
    db.add(admin)
    await db.commit()


@router.get("", response_model=AdminList)
async def list_admins(
    admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> AdminList:
    _require_owner(admin)
    # Resellers have their own page (app/routers/resellers.py).
    result = await db.execute(select(Admin).where(Admin.is_reseller.is_(False)).order_by(Admin.id))
    admins = list(result.scalars().all())
    return AdminList(total=len(admins), admins=admins)


@router.post("", response_model=AdminListItem, status_code=201)
async def create_admin_account(
    payload: AdminCreate,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> Admin:
    _require_owner(admin)
    existing = await db.scalar(select(Admin).where(Admin.username == payload.username))
    if existing is not None:
        raise HTTPException(status_code=409, detail="An admin with this username already exists")

    new_admin = Admin(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        is_owner=False,
        permissions=payload.permissions,
    )
    db.add(new_admin)
    await db.commit()
    await db.refresh(new_admin)
    return new_admin


@router.put("/{admin_id}/permissions", response_model=AdminListItem)
async def update_admin_permissions(
    admin_id: int,
    payload: AdminPermissionsUpdate,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> Admin:
    _require_owner(admin)
    target = await db.get(Admin, admin_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Admin not found")
    if target.is_owner:
        raise HTTPException(status_code=400, detail="The owner account always has full access")
    if target.is_reseller:
        raise HTTPException(status_code=400, detail="A reseller's access is set on the Resellers page")

    target.permissions = payload.permissions
    db.add(target)
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{admin_id}", status_code=204)
async def delete_admin_account(
    admin_id: int,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    _require_owner(admin)
    target = await db.get(Admin, admin_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Admin not found")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if target.is_owner:
        raise HTTPException(status_code=400, detail="The owner account can't be deleted")

    await db.delete(target)
    await db.commit()
