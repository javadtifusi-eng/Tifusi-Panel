from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_staff_admin
from app.network_health.aggregate import build_report
from app.schemas.network_health import NetworkHealthReport

router = APIRouter(prefix="/api/network-health", tags=["network-health"], dependencies=[Depends(get_staff_admin)])


@router.get("", response_model=NetworkHealthReport)
async def network_health(
    hours: int = Query(default=24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
) -> NetworkHealthReport:
    return await build_report(db, hours)
