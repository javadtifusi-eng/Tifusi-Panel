from datetime import datetime, timezone
from typing import Callable, Coroutine

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import Admin
from app.models.api_key import ApiKey
from app.security import API_KEY_PREFIX, decode_access_token, hash_api_key

bearer_scheme = HTTPBearer(auto_error=False)


async def _admin_from_api_key(token: str, db: AsyncSession) -> Admin:
    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == hash_api_key(token)))
    api_key = result.scalar_one_or_none()
    if api_key is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    admin = await db.get(Admin, api_key.admin_id)
    if admin is None:
        raise HTTPException(status_code=401, detail="Admin account no longer exists")

    api_key.last_used_at = datetime.now(timezone.utc)
    db.add(api_key)
    await db.commit()
    return admin


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Admin:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials
    if token.startswith(API_KEY_PREFIX):
        return await _admin_from_api_key(token, db)

    payload = decode_access_token(token)
    username = payload.get("sub") if payload else None
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    result = await db.execute(select(Admin).where(Admin.username == username))
    admin = result.scalar_one_or_none()
    if admin is None:
        raise HTTPException(status_code=401, detail="Admin account no longer exists")

    # payload.get("tv") is None for a token minted before this existed —
    # treated as version 0, same as every Admin row's own default, so an
    # old still-live token isn't logged out by this change itself.
    if payload.get("tv", 0) != admin.token_version:
        raise HTTPException(status_code=401, detail="This session was invalidated by a password change")

    return admin


def require_permission(scope: str) -> Callable[..., Coroutine[None, None, Admin]]:
    """A per-router replacement for plain get_current_admin: same auth,
    plus a scope check. The owner is never restricted; a non-owner admin
    with permissions=None (every admin created before this existed, and
    any created since without explicit scoping) is unrestricted too —
    only an admin with a real, non-null permissions list gets narrowed."""

    async def _check(admin: Admin = Depends(get_current_admin)) -> Admin:
        if not admin.is_owner and admin.permissions is not None and scope not in admin.permissions:
            raise HTTPException(status_code=403, detail=f"Your admin account doesn't have access to {scope}")
        return admin

    return _check
