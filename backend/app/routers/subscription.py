from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.groups.access import hosts_for_user
from app.links.generator import build_links_for_user, build_subscription_content
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser
from app.wireguard.allocate import get_or_create_peer
from app.wireguard.config import build_client_config

# Deliberately not behind get_current_admin: client apps hit this URL directly
# using the unguessable secret as the only credential, the same way every
# other proxy panel's subscription link works.
router = APIRouter(tags=["subscription"])


async def _user_or_404(secret: str, db: AsyncSession) -> ProxyUser:
    user = await db.scalar(select(ProxyUser).where(ProxyUser.secret == secret))
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")
    return user


@router.get("/sub/{secret}")
async def get_subscription(secret: str, db: AsyncSession = Depends(get_db)) -> Response:
    user = await _user_or_404(secret, db)
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    content = build_subscription_content(build_links_for_user(user, allowed_hosts))
    return Response(content=content, media_type="text/plain; charset=utf-8")


@router.get("/sub/{secret}/wireguard")
async def get_subscription_wireguard(secret: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """WireGuard has no URI scheme to fold into the plain-text subscription
    body above, so a client that needs it (or the user, by hand) fetches its
    own configs here — still gated by nothing but the same unguessable secret."""
    user = await _user_or_404(secret, db)
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)

    configs = []
    for host in allowed_hosts:
        if host.protocol != HostProtocol.wireguard:
            continue
        try:
            peer = await get_or_create_peer(host, user, db)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        configs.append({"remark": host.remark, "config": build_client_config(peer, host)})
    return configs
