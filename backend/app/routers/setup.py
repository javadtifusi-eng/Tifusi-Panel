import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import Admin
from app.models.setup_key import SetupKey
from app.rate_limit import check, client_key, record_failure
from app.schemas.auth import CreateAdminRequest, SetupStatus, TokenResponse
from app.security import create_access_token, hash_password

router = APIRouter(prefix="/api/setup", tags=["setup"])

# The key itself has plenty of entropy (secrets.token_urlsafe(24) in
# backend/cli/main.py), so this is a much looser cap than login's — it's
# here to stop a script from hammering this endpoint, not because the key
# is realistically guessable within it.
_MAX_ATTEMPTS, _WINDOW_SECONDS = 20, 300.0

# Serializes the whole check-then-create sequence below: without it, two
# create-admin requests arriving close together could both read
# admin_count == 0 (or both read the same setup key as unused) before
# either had committed, and both go on to create an owner account /
# consume the same key. A single process-wide lock is enough — this panel
# always runs as one uvicorn process (see backend/run.py), so there's no
# second process a lock here wouldn't also see.
_create_admin_lock = asyncio.Lock()


async def _admin_count(db: AsyncSession) -> int:
    return await db.scalar(select(func.count()).select_from(Admin))


@router.get("/status", response_model=SetupStatus)
async def get_setup_status(db: AsyncSession = Depends(get_db)) -> SetupStatus:
    return SetupStatus(has_admin=(await _admin_count(db)) > 0)


@router.post("/create-admin", response_model=TokenResponse)
async def create_admin(
    payload: CreateAdminRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    ip_key = client_key(request)
    check(ip_key, max_attempts=_MAX_ATTEMPTS, window_seconds=_WINDOW_SECONDS)

    async with _create_admin_lock:
        if await _admin_count(db) > 0:
            raise HTTPException(status_code=409, detail="An admin account already exists")

        result = await db.execute(
            select(SetupKey).where(SetupKey.key == payload.key, SetupKey.used.is_(False))
        )
        setup_key = result.scalar_one_or_none()
        if setup_key is None:
            record_failure(ip_key)
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

    return TokenResponse(access_token=create_access_token(subject=payload.username, token_version=0))
