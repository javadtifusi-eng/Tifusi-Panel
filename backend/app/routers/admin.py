from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.schemas.admin import AdminProfileResponse, ChangePasswordRequest
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/admin", tags=["admin"])


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
