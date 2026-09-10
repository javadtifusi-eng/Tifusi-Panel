from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.groups.access import hosts_for_user
from app.links.generator import build_ipsec_configs_for_user, build_links_for_user, build_subscription_content
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser, UserStatus
from app.models.user_device import UserDevice
from app.settings_store import get_public_url
from app.subscription.clash import build_clash_config
from app.subscription.ikev2_profile import build_ikev2_mobileconfig
from app.subscription.info_page import build_info_page_html
from app.subscription.singbox import build_singbox_config

_STATUS_LABELS_FA = {
    UserStatus.active: "فعال",
    UserStatus.disabled: "غیرفعال",
    UserStatus.expired: "منقضی",
    UserStatus.limited: "اتمام حجم",
    UserStatus.on_hold: "در انتظار فعال‌سازی",
}

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
_SINGBOX_USER_AGENTS = ("sing-box", "singbox", "sfa", "sfi", "sfm", "karing")


def _wants(user_agent: str | None, markers: tuple[str, ...]) -> bool:
    if not user_agent:
        return False
    ua = user_agent.lower()
    return any(marker in ua for marker in markers)


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


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _activate_if_on_hold(user: ProxyUser, db: AsyncSession) -> None:
    """The whole point of on_hold: expire doesn't start counting down from
    account creation, it starts from whenever a client actually fetches the
    subscription for the first time — which is exactly this request."""
    if user.status != UserStatus.on_hold:
        return
    user.status = UserStatus.active
    if user.on_hold_expire_days is not None:
        user.expire = datetime.now(timezone.utc) + timedelta(days=user.on_hold_expire_days)
    db.add(user)
    await db.commit()
    await db.refresh(user)


async def _enforce_device_limit(user: ProxyUser, identifier: str, db: AsyncSession) -> None:
    """Best-effort device limiting: a "device" is whatever fetches this
    subscription URL, identified by an explicit ?hwid= the client sent or
    else its IP. Only a *new* identifier can be turned away — one already
    on file always gets served, so a returning device is never randomly
    locked out by another device's request racing it."""
    if not user.hwid_limit:
        return

    existing = await db.scalar(
        select(UserDevice).where(UserDevice.user_id == user.id, UserDevice.identifier == identifier)
    )
    if existing is not None:
        existing.last_seen = datetime.now(timezone.utc)
        db.add(existing)
        await db.commit()
        return

    device_count = await db.scalar(
        select(func.count()).select_from(UserDevice).where(UserDevice.user_id == user.id)
    )
    if device_count is not None and device_count >= user.hwid_limit:
        raise HTTPException(status_code=403, detail="Device limit reached for this account")

    db.add(UserDevice(user_id=user.id, identifier=identifier))
    await db.commit()


@router.get("/sub/{secret}")
async def get_subscription(
    secret: str,
    request: Request,
    hwid: str | None = Query(default=None),
    user_agent: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Response:
    user = await _user_or_404(secret, db)

    await _enforce_device_limit(user, hwid or _client_ip(request), db)
    await _activate_if_on_hold(user, db)

    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)

    # A real browser opening this URL by hand sends `Accept: text/html,...`
    # first — practically no VPN client's HTTP fetch does, so this is a
    # reliable enough signal to show a real page instead of the raw
    # base64/YAML/JSON body a client actually needs. Checked ahead of the
    # client-marker branches below since a human explicitly asking for html
    # takes priority over guessing from User-Agent.
    accept = request.headers.get("accept") or ""
    if "text/html" in accept:
        public_url = await get_public_url(db)
        base = public_url.rstrip("/") + "/" if public_url else str(request.base_url)
        ikev2_configs, l2tp_configs = build_ipsec_configs_for_user(user, allowed_hosts, base)
        html = build_info_page_html(
            username=user.username,
            status=_STATUS_LABELS_FA.get(user.status, user.status.value),
            used_traffic=user.used_traffic,
            data_limit=user.data_limit,
            expire_text=user.expire.strftime("%Y-%m-%d") if user.expire else "بدون انقضا",
            subscription_url=f"{base}sub/{user.secret}",
            links=build_links_for_user(user, allowed_hosts),
            ikev2_configs=ikev2_configs,
            l2tp_configs=l2tp_configs,
        )
        return Response(content=html, media_type="text/html; charset=utf-8")

    if _wants(user_agent, _CLASH_USER_AGENTS):
        content = build_clash_config(user, allowed_hosts)
        media_type = "text/yaml; charset=utf-8"
    elif _wants(user_agent, _SINGBOX_USER_AGENTS):
        content = build_singbox_config(user, allowed_hosts)
        media_type = "application/json; charset=utf-8"
    else:
        content = build_subscription_content(build_links_for_user(user, allowed_hosts))
        media_type = "text/plain; charset=utf-8"

    return Response(
        content=content, media_type=media_type, headers={"Subscription-Userinfo": _userinfo_header(user)}
    )


@router.get("/sub/{secret}/ikev2.mobileconfig")
async def get_ikev2_profile(secret: str, db: AsyncSession = Depends(get_db)) -> Response:
    """A tap-to-install iOS/macOS profile — same secret-as-credential model
    as the main subscription link — so IKEv2 users skip typing server/
    remote-ID/username/password into Settings > VPN by hand."""
    user = await _user_or_404(secret, db)

    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    host = next((h for h in allowed_hosts if h.protocol == HostProtocol.ikev2), None)
    if host is None:
        raise HTTPException(status_code=404, detail="No IKEv2 host available for this user")

    content = build_ikev2_mobileconfig(user, host)
    return Response(
        content=content,
        media_type="application/x-apple-aspen-config",
        headers={"Content-Disposition": 'attachment; filename="ikev2.mobileconfig"'},
    )
