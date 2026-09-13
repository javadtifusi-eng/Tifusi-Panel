"""How the panel's public, no-admin-auth endpoints (subscription links, the
Android app's config and report endpoints) turn a caller-supplied credential
into a user and tell who is calling. Shared here rather than kept private to
app/routers/subscription.py because app/routers/app_reports.py resolves the
very same subscription links and app codes, and two copies of a credential
check are two places to get it subtly wrong.
"""
import hmac

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import ProxyUser
from app.subscription.app_code import app_code_for


async def user_or_404(secret: str, db: AsyncSession) -> ProxyUser:
    user = await db.scalar(select(ProxyUser).where(ProxyUser.secret == secret))
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")
    return user


async def user_by_app_code_or_404(code: str, db: AsyncSession) -> ProxyUser:
    # Codes are derived from each secret rather than stored, so there is no
    # column to query; a scan is fine at panel scale and needs no migration.
    wanted = code.strip().lower().encode()
    for user in (await db.execute(select(ProxyUser))).scalars().all():
        if hmac.compare_digest(app_code_for(user).lower().encode(), wanted):
            return user
    raise HTTPException(status_code=404, detail="Not found")


async def user_by_subscription_or_404(value: str, db: AsyncSession) -> ProxyUser:
    """Accepts whatever the Android app was set up with — the full
    subscription link (https://host/sub/<secret>, possibly with a trailing
    slash, a query string, or a sub-path like /app.json) or the short app
    code, which the app may carry as CODE@host so it knows which panel to
    ask. Either way the same 404 comes back for anything that doesn't
    resolve, so this can't be used to tell a bad link from a bad code."""
    value = value.strip()
    if "/sub/" in value:
        secret = value.split("/sub/", 1)[1]
        secret = secret.split("?", 1)[0].split("#", 1)[0].strip("/").split("/", 1)[0]
        if not secret:
            raise HTTPException(status_code=404, detail="Not found")
        return await user_or_404(secret, db)

    code = value.split("@", 1)[0].strip()
    if not code:
        raise HTTPException(status_code=404, detail="Not found")
    return await user_by_app_code_or_404(code, db)


def client_ip(request: Request) -> str:
    # X-Real-IP is what this project's own nginx (frontend/nginx.conf) sets
    # to the real TCP peer, overwriting anything the client sent — safe to
    # trust. X-Forwarded-For is NOT: nginx never touches it, so a client
    # could set it to a fresh value on every request (or skip nginx
    # entirely and hit the panel's own published port directly), which
    # used to make the IP fallback below trivial to spoof into a useless
    # per-request "device" limit.
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"
