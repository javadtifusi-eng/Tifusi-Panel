from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import Admin
from app.models.setup_key import SetupKey
from app.schemas.auth import CreateAdminRequest, SetupStatus, TokenResponse
from app.security import create_access_token, hash_password

router = APIRouter(prefix="/api/setup", tags=["setup"])


async def _admin_count(db: AsyncSession) -> int:
    return await db.scalar(select(func.count()).select_from(Admin))


@router.get("/status", response_model=SetupStatus)
async def get_setup_status(db: AsyncSession = Depends(get_db)) -> SetupStatus:
    return SetupStatus(has_admin=(await _admin_count(db)) > 0)


@router.post("/create-admin", response_model=TokenResponse)
async def create_admin(
    payload: CreateAdminRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    if await _admin_count(db) > 0:
        raise HTTPException(status_code=409, detail="An admin account already exists")

    result = await db.execute(
        select(SetupKey).where(SetupKey.key == payload.key, SetupKey.used.is_(False))
    )
    setup_key = result.scalar_one_or_none()
    if setup_key is None:
        raise HTTPException(status_code=400, detail="Invalid or already-used setup key")

    expires_at = setup_key.expires_at
    if expires_at.tzinfo is None:
        # SQLite has no native timezone type and hands naive datetimes back;
        # treat them as UTC (what the CLI wrote them as) rather than compare naive-to-aware.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Setup key has expired, generate a new one")

    admin = Admin(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        is_owner=True,
    )
    setup_key.used = True
    db.add_all([admin, setup_key])
    await db.commit()

    return TokenResponse(access_token=create_access_token(subject=payload.username))
