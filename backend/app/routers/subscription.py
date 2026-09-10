from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.groups.access import hosts_for_user
from app.links.generator import build_links_for_user, build_subscription_content
from app.models.host import Host
from app.models.user import ProxyUser
from app.subscription.clash import build_clash_config

# Deliberately not behind get_current_admin: client apps hit this URL directly
# using the unguessable secret as the only credential, the same way every
# other proxy panel's subscription link works.
router = APIRouter(tags=["subscription"])

# Substrings from real Clash-family clients' own User-Agent headers (Clash
# Meta/mihomo, Clash Verge, Stash, ClashX Meta, ...) — anything matching gets
# a real Clash YAML config instead of the plain base64 URI list, so the same
# one subscription URL works correctly in either kind of client without the
# admin having to hand out a second, format-specific link.
_CLASH_USER_AGENTS = ("clash", "mihomo", "stash")


def _wants_clash(user_agent: str | None) -> bool:
    if not user_agent:
        return False
    ua = user_agent.lower()
    return any(marker in ua for marker in _CLASH_USER_AGENTS)


async def _user_or_404(secret: str, db: AsyncSession) -> ProxyUser:
    user = await db.scalar(select(ProxyUser).where(ProxyUser.secret == secret))
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")
    return user


def _userinfo_header(user: ProxyUser) -> str:
    # The de-facto standard subscription header (Clash, v2rayN, and others
    # all read it) so a client can show remaining data/expiry in its own UI
    # without parsing every link.
    parts = ["upload=0", f"download={user.used_traffic}", f"total={user.data_limit or 0}"]
    if user.expire is not None:
        parts.append(f"expire={int(user.expire.timestamp())}")
    return "; ".join(parts)


@router.get("/sub/{secret}")
async def get_subscription(
    secret: str, user_agent: str | None = Header(default=None), db: AsyncSession = Depends(get_db)
) -> Response:
    user = await _user_or_404(secret, db)
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)

    if _wants_clash(user_agent):
        content = build_clash_config(user, allowed_hosts)
        media_type = "text/yaml; charset=utf-8"
    else:
        content = build_subscription_content(build_links_for_user(user, allowed_hosts))
        media_type = "text/plain; charset=utf-8"

    return Response(
        content=content, media_type=media_type, headers={"Subscription-Userinfo": _userinfo_header(user)}
    )
