import asyncio
import time
from pathlib import Path

import httpx
import psutil
from fastapi import APIRouter, Depends

from app.dependencies import get_current_admin

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(get_current_admin)])

_BOOT_TIME = psutil.boot_time()

# WORKDIR is /app in the container; backend/Dockerfile COPYs this file to
# /app/VERSION right next to the /app/app package this module lives in —
# three parents up from here (routers -> app -> /app).
_VERSION_FILE = Path(__file__).resolve().parent.parent.parent / "VERSION"
_GITHUB_TAGS_URL = "https://api.github.com/repos/javadtifusi-eng/Tifusi-Panel/tags"


def _current_version() -> str:
    try:
        return _VERSION_FILE.read_text().strip()
    except OSError:
        return "0.0.0"


def _parse_version(v: str) -> tuple[int, ...]:
    v = v.lstrip("vV")
    parts: list[int] = []
    for chunk in v.split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


@router.get("/version")
async def get_version() -> dict:
    current = _current_version()
    latest: str | None = None
    # Best-effort only: no network, GitHub rate-limiting, or a repo with no
    # tags yet must never turn this into a 500 — the panel just reports
    # "can't check right now" and moves on.
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(_GITHUB_TAGS_URL, headers={"Accept": "application/vnd.github+json"})
            if resp.status_code == 200:
                tags = resp.json()
                if isinstance(tags, list) and tags:
                    latest = tags[0].get("name")
    except (httpx.HTTPError, ValueError):
        pass

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
