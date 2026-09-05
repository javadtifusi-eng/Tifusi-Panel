"""Group membership is an access filter, not just an organizational label.

A host with no group is global — every user can see it in their links and
gets added to it on the node. Once a host joins at least one group, it
becomes restricted: only users sharing at least one of those groups get
it — both in the links/subscription they're shown AND as a client in the
Xray config actually pushed to the node. The two functions below are the
single source of truth for that rule; call them instead of re-deriving it.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.models.host import Host
from app.models.user import ProxyUser


def hosts_for_user(user: ProxyUser, hosts: list[Host]) -> list[Host]:
    user_group_ids = {g.id for g in user.groups}
    return [
        host
        for host in hosts
        if not (host_group_ids := {g.id for g in host.groups}) or (user_group_ids & host_group_ids)
    ]


def users_for_host(host: Host, users: list[ProxyUser]) -> list[ProxyUser]:
    host_group_ids = {g.id for g in host.groups}
    if not host_group_ids:
        return users
    return [u for u in users if host_group_ids & {g.id for g in u.groups}]


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
