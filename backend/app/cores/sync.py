"""Keeps the Inbound registry (app/models/inbound.py) in sync with a Core's
raw Xray JSON — call sync_inbounds() any time a Core's `config` is created
or updated. Inbound rows are the panel's own bookkeeping, not a second
source of truth: everything on them is re-derived from the JSON every time.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core
from app.models.host import Host
from app.models.inbound import Inbound
from app.xray_config.inbound_parser import parse_inbounds


async def sync_inbounds(core: Core, db: AsyncSession) -> list[str]:
    """Returns non-fatal parse warnings (e.g. a REALITY inbound with a bad
    key) for inbounds that were skipped. Raises HTTPException for anything
    that would corrupt state: a tag collision with another Core, or
    removing a tag that a Host still depends on."""
    parsed = parse_inbounds(core.config)
    warnings: list[str] = []
    parsed_by_tag = {}
    for p in parsed:
        if p.error:
            warnings.append(p.error)
            continue
        parsed_by_tag[p.tag] = p

    if parsed_by_tag:
        existing_elsewhere = await db.execute(
            select(Inbound.tag, Inbound.core_id).where(
                Inbound.tag.in_(parsed_by_tag.keys()), Inbound.core_id != core.id
            )
        )
        collisions = [tag for tag, _ in existing_elsewhere.all()]
        if collisions:
            raise HTTPException(
                status_code=400,
                detail=f"Tag(s) already used by another Core: {', '.join(collisions)}",
            )

    current = {i.tag: i for i in core.inbounds}

    removed_tags = set(current) - set(parsed_by_tag)
    if removed_tags:
        in_use = await db.execute(
            select(Host.id, Inbound.tag)
            .join(Inbound, Host.inbound_id == Inbound.id)
            .where(Inbound.tag.in_(removed_tags))
        )
        blocking = [tag for _, tag in in_use.all()]
        if blocking:
            raise HTTPException(
                status_code=400,
                detail=f"Can't remove inbound tag(s) still used by a Host: {', '.join(set(blocking))}",
            )

    for tag in removed_tags:
        await db.delete(current[tag])

    for tag, p in parsed_by_tag.items():
        row = current.get(tag)
        if row is None:
            row = Inbound(tag=tag, core_id=core.id)
            db.add(row)
        row.protocol = p.protocol
        row.network = p.network
        row.security = p.security
        row.port = p.port
        row.encryption = p.encryption
        row.flow = p.flow
        row.header_type = p.header_type
        row.path = p.path
        row.host_header = p.host_header
        row.sni = p.sni
        row.alpn = p.alpn
        row.fingerprint = p.fingerprint
        row.reality_public_key = p.reality_public_key
        row.reality_short_id = p.reality_short_id

    return warnings
