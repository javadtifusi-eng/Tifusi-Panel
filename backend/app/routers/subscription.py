import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.groups.access import hosts_for_user
from app.links.generator import build_ipsec_configs_for_user, build_links_for_user, build_subscription_content
from app.models.host import Host, HostProtocol
from app.models.user import ProxyUser, UserStatus
from app.models.user_device import UserDevice
from app.nodes.sync import resync_nodes_in_background
from app.settings_store import get_subscription_url
from app.subscription.app_code import app_code_with_host
from app.subscription.clash import build_clash_config
from app.subscription.ikev2_profile import build_ikev2_mobileconfig
from app.subscription.info_page import build_info_page_html
from app.subscription.lookup import client_ip, user_by_app_code_or_404, user_or_404
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


def _userinfo_header(user: ProxyUser) -> str:
    # The de-facto standard subscription header (Clash, v2rayN, and others
    # all read it) so a client can show remaining data/expiry in its own UI
    # without parsing every link.
    parts = ["upload=0", f"download={user.used_traffic}", f"total={user.data_limit or 0}"]
    if user.expire is not None:
        parts.append(f"expire={int(user.expire.timestamp())}")
    return "; ".join(parts)


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


async def _moved_to_subscription_host(request: Request, db: AsyncSession) -> RedirectResponse | None:
    """Sends a subscription fetch that arrived on the panel's own address over to
    the customer-facing one, when the two differ.

    Every app that was handed a link before the split still polls the old
    address. Nothing in any subscription format can rewrite the URL an app has
    saved — there is no header for it — so a permanent redirect is the only lever
    there is: clients follow it, several remember the final address, and the
    panel's own domain stops being the one customers talk to.

    Returned rather than raised so the caller can send it *before* the device
    limit and on-hold activation run, since those have side effects that must not
    happen twice for one fetch.

    Doing nothing is the default: with no separate subscription address
    configured, or when the fetch already arrived on it, this returns None.
    """
    configured = await get_subscription_url(db)
    if not configured:
        return None
    target_host = urlsplit(configured).hostname
    # nginx passes the real Host through (frontend/nginx.conf), so this is the
    # name the client actually asked for rather than a container hostname.
    if not target_host or request.url.hostname == target_host:
        return None
    moved = urlsplit(configured)
    url = urlunsplit((moved.scheme or "https", moved.netloc, request.url.path, request.url.query, ""))
    return RedirectResponse(url, status_code=301)


async def _render_info_page(user: ProxyUser, request: Request, db: AsyncSession) -> str:
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    # The customer-facing base, which can be a different domain from the one the
    # admin reaches the panel on — see PanelSetting.subscription_url.
    sub_url = await get_subscription_url(db)
    base = sub_url.rstrip("/") + "/" if sub_url else str(request.base_url)
    ikev2_configs, l2tp_configs = build_ipsec_configs_for_user(user, allowed_hosts, base)
    return build_info_page_html(
        username=user.username,
        status=_STATUS_LABELS_FA.get(user.status, user.status.value),
        used_traffic=user.used_traffic,
        data_limit=user.data_limit,
        expire_text=user.expire.strftime("%Y-%m-%d") if user.expire else "بدون انقضا",
        subscription_url=f"{base}sub/{user.secret}",
        app_code=app_code_with_host(user, base),
        links=build_links_for_user(user, allowed_hosts),
        ikev2_configs=ikev2_configs,
        l2tp_configs=l2tp_configs,
    )


@router.get("/sub/{secret}")
async def get_subscription(
    secret: str,
    request: Request,
    hwid: str | None = Query(default=None),
    user_agent: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # Ahead of user lookup and of anything with a side effect: a fetch that is
    # about to be sent elsewhere must not spend a device slot or activate an
    # on-hold account here and then again at the destination.
    moved = await _moved_to_subscription_host(request, db)
    if moved is not None:
        return moved

    user = await user_or_404(secret, db)

    await _enforce_device_limit(user, hwid or client_ip(request), db)
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
        html = await _render_info_page(user, request, db)
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


@router.post("/sub/{secret}/reset")
async def reset_subscription_secret(
    secret: str, request: Request, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)
) -> Response:
    """Self-service secret rotation — same DB-level effect as the
    admin-facing POST /api/users/{id}/reset-secret (app/routers/users.py),
    just reachable from the public info page using the current secret as
    the only proof of ownership, same as every other endpoint in this
    router. Returns the freshly rendered info page body (not JSON) so the
    caller can swap it straight into the DOM without reimplementing this
    module's HTML in JavaScript — the new secret rides along in the
    X-New-Secret header for the caller to update its own URL with."""
    user = await user_or_404(secret, db)
    user.secret = str(uuid_lib.uuid4())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # The secret is also the IKEv2/L2TP password for users who never picked their own.
    background_tasks.add_task(resync_nodes_in_background)

    html = await _render_info_page(user, request, db)
    return Response(content=html, media_type="text/html; charset=utf-8", headers={"X-New-Secret": user.secret})


@router.get("/sub/{secret}/ikev2.mobileconfig")
async def get_ikev2_profile(secret: str, db: AsyncSession = Depends(get_db)) -> Response:
    """A tap-to-install iOS/macOS profile — same secret-as-credential model
    as the main subscription link — so IKEv2 users skip typing server/
    remote-ID/username/password into Settings > VPN by hand."""
    user = await user_or_404(secret, db)

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


async def _app_config(user: ProxyUser, request: Request, hwid: str | None, db: AsyncSession) -> dict:
    """What the Tifusi VPN Android app imports: the same IKEv2/L2TP fields the
    info page's cards show, as JSON, so the app can fetch and refresh them.
    Same device limit and on_hold activation as the main subscription link,
    since the app is one more client of it."""
    await _enforce_device_limit(user, hwid or client_ip(request), db)
    await _activate_if_on_hold(user, db)

    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    # The customer-facing base, which can be a different domain from the one the
    # admin reaches the panel on — see PanelSetting.subscription_url.
    sub_url = await get_subscription_url(db)
    base = sub_url.rstrip("/") + "/" if sub_url else str(request.base_url)
    ikev2_configs, l2tp_configs = build_ipsec_configs_for_user(user, allowed_hosts, base)
    for cfg in ikev2_configs:
        cfg.pop("mobileconfig_url", None)
    links = build_links_for_user(user, allowed_hosts)

    return {
        "v": 1,
        "username": user.username,
        # The address this account should be fetched from, which is not
        # necessarily the one this request arrived on. An app that stores it can
        # follow the panel onto a new customer-facing domain by itself, instead of
        # every user having to be sent a new link by hand. Additive under "v": 1,
        # so an older build simply ignores it.
        "subscription_url": f"{base}sub/{user.secret}",
        "status": user.status.value,
        "expire": int(user.expire.timestamp()) if user.expire else None,
        "used_traffic": user.used_traffic,
        "data_limit": user.data_limit,
        "ikev2": ikev2_configs,
        "l2tp": l2tp_configs,
        # The same share links the plain subscription serves, split by what the
        # app's own core can dial. Additive under "v": 1, so an older build that
        # does not know a key simply ignores it.
        "vless": [link for link in links if link.startswith("vless://")],
        "hysteria2": [link for link in links if link.startswith("hysteria2://")],
    }


@router.get("/sub/{secret}/app.json", response_model=None)
async def get_app_config(
    secret: str,
    request: Request,
    hwid: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict | RedirectResponse:
    moved = await _moved_to_subscription_host(request, db)
    if moved is not None:
        return moved
    user = await user_or_404(secret, db)
    return await _app_config(user, request, hwid, db)


@router.get("/code/{code}/app.json", response_model=None)
async def get_app_config_by_code(
    code: str,
    request: Request,
    hwid: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict | RedirectResponse:
    moved = await _moved_to_subscription_host(request, db)
    if moved is not None:
        return moved
    user = await user_by_app_code_or_404(code, db)
    return await _app_config(user, request, hwid, db)
