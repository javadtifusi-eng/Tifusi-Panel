from typing import Callable, Coroutine

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import Admin
from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Admin:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    username = decode_access_token(credentials.credentials)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    result = await db.execute(select(Admin).where(Admin.username == username))
    admin = result.scalar_one_or_none()
    if admin is None:
        raise HTTPException(status_code=401, detail="Admin account no longer exists")

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
