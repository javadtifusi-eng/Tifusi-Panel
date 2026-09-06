"""Group membership is an access filter, not just an organizational label.

Two independent mechanisms, matching how PasarGuard actually does it:
- vless/vmess/trojan/shadowsocks hosts: access is controlled by the Inbound
  they use — a Group grants whole Inbound tags, and every user in that
  group gets every host built on top of it. A host doesn't get its own
  separate ACL; its Inbound's groups are the only thing that matters.
- wireguard/hysteria2 hosts aren't Xray inbounds at all, so they keep the
  original direct Group<->Host link instead.

Either way, an Inbound/host in no group at all is global — every user gets
it, both in their links/subscription and as a client actually pushed to
the node.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.models.host import XRAY_PROTOCOLS, Host
from app.models.inbound import Inbound
from app.models.user import ProxyUser


def _host_group_ids(host: Host) -> set[int]:
    if host.protocol in XRAY_PROTOCOLS:
        return {g.id for g in host.inbound.groups} if host.inbound else set()
    return {g.id for g in host.groups}


def hosts_for_user(user: ProxyUser, hosts: list[Host]) -> list[Host]:
    user_group_ids = {g.id for g in user.groups}
    return [
        host
        for host in hosts
        if not (host_group_ids := _host_group_ids(host)) or (user_group_ids & host_group_ids)
    ]


def users_for_host(host: Host, users: list[ProxyUser]) -> list[ProxyUser]:
    host_group_ids = _host_group_ids(host)
    if not host_group_ids:
        return users
    return [u for u in users if host_group_ids & {g.id for g in u.groups}]


def users_for_inbound(inbound: Inbound, users: list[ProxyUser]) -> list[ProxyUser]:
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
