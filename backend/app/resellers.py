"""Reseller accounts: a non-owner admin that only ever manages its own users,
limited to the protocols the owner picked and, optionally, to a number of
users and a total volume.

The volume quota is the sum of the data limits the reseller's current users
carry, computed live on every check — deleting a user frees its volume, and
there is no separate balance to keep in step. Settling up with a reseller
happens outside the panel."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import Admin
from app.models.host import Host
from app.models.user import ProxyUser

GB = 1024**3


def _gb(n: int) -> str:
    return f"{n / GB:.1f}".removesuffix(".0") + " GB"


async def reseller_usage(admin_id: int, db: AsyncSession) -> tuple[int, int, int]:
    """(user count, sum of their data limits, sum of their used traffic)."""
    row = (
        await db.execute(
            select(
                func.count(ProxyUser.id),
                func.coalesce(func.sum(ProxyUser.data_limit), 0),
                func.coalesce(func.sum(ProxyUser.used_traffic), 0),
            ).where(ProxyUser.admin_id == admin_id)
        )
    ).one()
    return int(row[0]), int(row[1]), int(row[2])


async def check_quota(admin: Admin, db: AsyncSession, *, new_users: int = 0, data_delta: int = 0) -> None:
    """Must run before the change is added to the session, or autoflush would
    count it twice."""
    if not admin.is_reseller:
        return
    count, allocated, _ = await reseller_usage(admin.id, db)
    if new_users and admin.max_users is not None and count + new_users > admin.max_users:
        raise HTTPException(
            status_code=403,
            detail=f"User limit reached: this reseller account can have at most {admin.max_users} users ({count} already)",
        )
    if data_delta > 0 and admin.data_quota is not None and allocated + data_delta > admin.data_quota:
        left = max(0, admin.data_quota - allocated)
        raise HTTPException(
            status_code=403,
            detail=f"Data quota reached: {_gb(left)} of your {_gb(admin.data_quota)} is left to give out",
        )


def check_data_limit(admin: Admin, data_limit: int | None) -> None:
    # An unlimited user would slip past a volume quota entirely.
    if admin.is_reseller and admin.data_quota is not None and not data_limit:
        raise HTTPException(
            status_code=400, detail="Set a data limit: a reseller with a data quota can't create unlimited users"
        )


def check_no_groups(admin: Admin, group_ids: list[int] | None) -> None:
    # Groups grant hosts, which would reach past the reseller's protocols.
    if admin.is_reseller and group_ids:
        raise HTTPException(status_code=403, detail="Reseller accounts can't assign groups")


def resolve_user_protocols(admin: Admin, requested: list[str] | None) -> list[str] | None:
    """What a new or edited user's protocols become. A reseller's user always
    gets an explicit subset of the reseller's own (all of them when none are
    named); anyone else's is left as asked, where None means every protocol."""
    if not admin.is_reseller:
        return requested
    allowed = admin.protocols or []
    if requested is None:
        return list(allowed)
    if not requested:
        raise HTTPException(status_code=400, detail="Pick at least one protocol")
    extra = sorted(set(requested) - set(allowed))
    if extra:
        raise HTTPException(status_code=403, detail=f"Your reseller account can't use: {', '.join(extra)}")
    return list(dict.fromkeys(requested))


async def protocol_catalog(db: AsyncSession, only: list[str] | None = None) -> list[dict]:
    """Each protocol that has at least one host, with those hosts' remarks —
    what the owner ticks for a reseller and a reseller ticks for a user."""
    rows = (await db.execute(select(Host.protocol, Host.remark).order_by(Host.id))).all()
    catalog: dict[str, list[str]] = {}
    for protocol, remark in rows:
        value = getattr(protocol, "value", protocol)
        if only is not None and value not in only:
            continue
        catalog.setdefault(value, []).append(remark)
    return [{"protocol": protocol, "hosts": hosts} for protocol, hosts in catalog.items()]
