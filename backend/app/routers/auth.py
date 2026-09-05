from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import Admin
from app.schemas.auth import LoginRequest, TokenResponse
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(Admin).where(Admin.username == payload.username))
    admin = result.scalar_one_or_none()
    if admin is None or not verify_password(payload.password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return TokenResponse(access_token=create_access_token(subject=admin.username))
