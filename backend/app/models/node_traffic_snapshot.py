from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class NodeTrafficSnapshot(Base):
    """Same idea as TrafficSnapshot (one row per UTC day), but broken down
    per node instead of summed across the whole panel — written by the same
    collect_traffic() cycle, just keyed by node_id too. Lets the dashboard
    show which node is actually carrying the traffic instead of only a
    panel-wide total."""

    __tablename__ = "node_traffic_snapshots"
    __table_args__ = (UniqueConstraint("node_id", "date", name="uq_node_traffic_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    total_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
