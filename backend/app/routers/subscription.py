from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.groups.access import hosts_for_user
from app.links.generator import build_links_for_user, build_subscription_content
from app.models.host import Host
from app.models.user import ProxyUser

# Deliberately not behind get_current_admin: client apps hit this URL directly
# using the unguessable secret as the only credential, the same way every
# other proxy panel's subscription link works.
router = APIRouter(tags=["subscription"])


@router.get("/sub/{secret}")
async def get_subscription(secret: str, db: AsyncSession = Depends(get_db)) -> Response:
    user = await db.scalar(select(ProxyUser).where(ProxyUser.secret == secret))
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")

    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    content = build_subscription_content(build_links_for_user(user, allowed_hosts))
    return Response(content=content, media_type="text/plain; charset=utf-8")
