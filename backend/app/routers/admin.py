from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.schemas.admin import AdminCreate, AdminList, AdminListItem, AdminProfileResponse, ChangePasswordRequest
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_owner(admin: Admin) -> None:
    if not admin.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner admin can manage other admins")


@router.get("/me", response_model=AdminProfileResponse)
async def get_me(admin: Admin = Depends(get_current_admin)) -> Admin:
    return admin


@router.put("/password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not verify_password(payload.current_password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    admin.hashed_password = hash_password(payload.new_password)
    db.add(admin)
    await db.commit()


@router.get("", response_model=AdminList)
async def list_admins(
    admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> AdminList:
    _require_owner(admin)
    result = await db.execute(select(Admin).order_by(Admin.id))
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

    new_admin = Admin(username=payload.username, hashed_password=hash_password(payload.password), is_owner=False)
    db.add(new_admin)
    await db.commit()
    await db.refresh(new_admin)
    return new_admin


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
