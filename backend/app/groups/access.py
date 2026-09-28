"""Group membership is an access filter, not just an organizational label.

Two independent mechanisms:
- vless/vmess/trojan/shadowsocks hosts: access is controlled by the Inbound
  they use — a Group grants whole Inbound tags, and every user in that
  group gets every host built on top of it. A host doesn't get its own
  separate ACL; its Inbound's groups are the only thing that matters.
- hysteria2 hosts aren't Xray inbounds at all, so they keep the original
  direct Group<->Host link instead.

Either way, an Inbound/host in no group at all is global — every user gets
it, both in their links/subscription and as a client actually pushed to
the node.

On top of groups, a user with a protocols list only gets hosts and inbounds
of those protocols — how a reseller picks protocols per user. When the first
host of a protocol appears, every user gets that protocol added (see
offer_new_protocol), so a new core reaches existing users without editing each.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import Admin
from app.models.group import Group
from app.models.host import XRAY_PROTOCOLS, Host
from app.models.inbound import Inbound
from app.models.user import ProxyUser


def _host_group_ids(host: Host) -> set[int]:
    if host.protocol in XRAY_PROTOCOLS:
        return {g.id for g in host.inbound.groups} if host.inbound else set()
    return {g.id for g in host.groups}


def allows_protocol(user: ProxyUser, protocol) -> bool:
    return user.protocols is None or getattr(protocol, "value", protocol) in user.protocols


async def offer_new_protocol(protocol, db: AsyncSession) -> bool:
    """Call before adding a host. If no host offered this protocol yet, add it
    to every user whose protocols list lacks it — the list was picked from what
    existed then, not to exclude something that did not exist. A reseller's
    users only get protocols the reseller is allowed. Returns True if any user
    changed, so the caller can resync the nodes."""
    if await db.scalar(select(Host.id).where(Host.protocol == protocol).limit(1)) is not None:
        return False
    value = getattr(protocol, "value", protocol)
    resellers = {a.id: a.protocols for a in (await db.execute(select(Admin).where(Admin.is_reseller))).scalars()}
    changed = False
    # JSON None can be stored as JSON null rather than SQL NULL, so filter here.
    for user in (await db.execute(select(ProxyUser))).scalars():
        if user.protocols is None or value in user.protocols:
            continue
        allowed = resellers.get(user.admin_id)
        if user.admin_id in resellers and allowed is not None and value not in allowed:
            continue
        user.protocols = [*user.protocols, value]
        changed = True
    return changed


def hosts_for_user(user: ProxyUser, hosts: list[Host]) -> list[Host]:
    user_group_ids = {g.id for g in user.groups}
    return [
        host
        for host in hosts
        if allows_protocol(user, host.protocol)
        and (not (host_group_ids := _host_group_ids(host)) or (user_group_ids & host_group_ids))
    ]


def users_for_host(host: Host, users: list[ProxyUser]) -> list[ProxyUser]:
    users = [u for u in users if allows_protocol(u, host.protocol)]
    host_group_ids = _host_group_ids(host)
    if not host_group_ids:
        return users
    return [u for u in users if host_group_ids & {g.id for g in u.groups}]


def users_for_inbound(inbound: Inbound, users: list[ProxyUser]) -> list[ProxyUser]:
    users = [u for u in users if allows_protocol(u, inbound.protocol)]
    inbound_group_ids = {g.id for g in inbound.groups}
    if not inbound_group_ids:
        return users
    return [u for u in users if inbound_group_ids & {g.id for g in u.groups}]


async def resolve_groups(ids: list[int] | None, db: AsyncSession) -> list[Group] | None:
    """None = leave membership untouched (used for PATCH-style updates);
    [] clears it; anything else must resolve to real, existing groups."""
    if ids is None:
        return None
    if not ids:
        return []
    result = await db.execute(select(Group).where(Group.id.in_(ids)))
    groups = list(result.scalars().all())
    if len(groups) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more group_ids not found")
    return groups


async def resolve_inbounds(ids: list[int] | None, db: AsyncSession) -> list[Inbound] | None:
    if ids is None:
        return None
    if not ids:
        return []
    result = await db.execute(select(Inbound).where(Inbound.id.in_(ids)))
    inbounds = list(result.scalars().all())
    if len(inbounds) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more inbound_ids not found")
    return inbounds
