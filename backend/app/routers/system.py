import asyncio
import re
import time

import httpx
import psutil
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.resellers import protocol_catalog
from app.version import __version__

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(get_current_admin)])

_BOOT_TIME = psutil.boot_time()

# The git ref advertisement (what `git ls-remote` reads), not the REST API: the
# API allows 60 unauthenticated requests an hour per IP, and once a server used
# them up the panel could no longer tell whether it was up to date.
_GITHUB_REFS_URL = "https://github.com/javadtifusi-eng/Tifusi-Panel.git/info/refs?service=git-upload-pack"
# Release tags only; the repo also carries others such as "tunnel-agent".
# Peeled entries ("refs/tags/v1.2^{}") are skipped by requiring the newline.
_RELEASE_TAG = re.compile(r"refs/tags/([vV]?\d+(?:\.\d+)*)\n")
_LATEST_TTL_SECONDS = 600
_LATEST_RETRY_SECONDS = 300

# (monotonic time of the last check, highest release tag found then)
_latest_cache: tuple[float | None, str | None] = (None, None)


def _parse_version(v: str) -> tuple[int, ...]:
    v = v.lstrip("vV")
    parts: list[int] = []
    for chunk in v.split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


async def _latest_release() -> str | None:
    """Highest release tag on GitHub, re-read at most every ten minutes. When GitHub can't
    be reached the last known answer is kept and retried after a few minutes."""
    global _latest_cache
    checked_at, latest = _latest_cache
    now = time.monotonic()
    if checked_at is not None and now - checked_at < _LATEST_TTL_SECONDS:
        return latest
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            resp = await client.get(_GITHUB_REFS_URL)
        resp.raise_for_status()
        versions = _RELEASE_TAG.findall(resp.text)
        if versions:
            latest = max(versions, key=_parse_version)
        _latest_cache = (now, latest)
    except httpx.HTTPError:
        _latest_cache = (now - _LATEST_TTL_SECONDS + _LATEST_RETRY_SECONDS, latest)
    return latest


@router.get("/protocols")
async def available_protocols(
    admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """Protocols that have at least one host, with how many — what an integration such as
    Tifusi Bot needs to decide what it can sell, without reading host addresses or keys (and so
    without the "hosts" permission). A reseller sees only its own protocols."""
    only = (admin.protocols or []) if admin.is_reseller else None
    return [{"protocol": c["protocol"], "hosts": len(c["hosts"])} for c in await protocol_catalog(db, only=only)]


@router.get("/version")
async def get_version() -> dict:
    current = __version__
    # Best-effort only: no network or a repo with no tags yet must never turn
    # this into a 500 — the panel just reports "can't check right now".
    latest = await _latest_release()
    update_available = latest is not None and _parse_version(latest) > _parse_version(current)
    return {"current": current, "latest": latest, "update_available": update_available}


@router.get("/stats")
async def system_stats() -> dict:
    # cpu_percent(interval=...) blocks for that long to measure a real
    # delta — run it off the event loop so it doesn't stall every other
    # request (including the traffic-sync background loop) for 0.3s.
    cpu_percent = await asyncio.to_thread(psutil.cpu_percent, 0.3)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "cpu_percent": cpu_percent,
        "cpu_count": psutil.cpu_count() or 1,
        "memory_percent": mem.percent,
        "memory_used": mem.used,
        "memory_total": mem.total,
        "disk_percent": disk.percent,
        "disk_used": disk.used,
        "disk_total": disk.total,
        "uptime_seconds": int(time.time() - _BOOT_TIME),
    }
