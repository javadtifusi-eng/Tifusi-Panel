from datetime import date

from sqlalchemy import BigInteger, Date
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TrafficSnapshot(Base):
    """One row per calendar day (UTC), holding the total uplink+downlink
    delta collected from every node that day — see collect_traffic() in
    app/traffic/sync.py, which is what actually increments this on every
    traffic-sync cycle. This is what the Statistics chart reads instead of
    re-summing every user's lifetime used_traffic, which has no notion of
    "how much was used on any given day"."""

    __tablename__ = "traffic_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    total_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
