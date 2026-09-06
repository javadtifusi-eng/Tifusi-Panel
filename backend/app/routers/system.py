import asyncio
import time

import psutil
from fastapi import APIRouter, Depends

from app.dependencies import get_current_admin

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(get_current_admin)])

_BOOT_TIME = psutil.boot_time()


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
