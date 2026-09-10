from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.traffic_snapshot import TrafficSnapshot
from app.schemas.stats import TrafficHistory, TrafficHistoryPoint

router = APIRouter(prefix="/api/stats", tags=["stats"], dependencies=[Depends(get_current_admin)])


@router.get("/traffic-history", response_model=TrafficHistory)
async def traffic_history(
    days: int = Query(default=30, ge=1, le=365), db: AsyncSession = Depends(get_db)
) -> TrafficHistory:
    start = datetime.now(timezone.utc).date() - timedelta(days=days - 1)
    result = await db.execute(
        select(TrafficSnapshot).where(TrafficSnapshot.date >= start).order_by(TrafficSnapshot.date)
    )
    by_date = {row.date: row.total_bytes for row in result.scalars().all()}

    # Fill in every day in the range, even ones with no traffic-sync cycle
    # recorded yet — a gap in the chart reads as "server was down", not
    # "zero traffic", so it has to actually be zero rather than missing.
    points = []
    for i in range(days):
        d = start + timedelta(days=i)
        points.append(TrafficHistoryPoint(date=d.isoformat(), total_bytes=by_date.get(d, 0)))

    return TrafficHistory(points=points)
