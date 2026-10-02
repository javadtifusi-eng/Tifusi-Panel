from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RealityResult(Base):
    """One REALITY name measured from inside Iran by the probe
    (backend/reality_probe), on the operator it ran on. Round 1 is a quick
    upload check of every candidate on one port; round 2 measures the best
    of them per port and fingerprint. Everything but run_at/client_ip/operator
    is reported by the probe."""

    __tablename__ = "reality_results"
    __table_args__ = (Index("ix_reality_results_run_at", "run_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    run_id: Mapped[str] = mapped_column(String(32))
    node_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    round: Mapped[int] = mapped_column(Integer, default=1)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(64), nullable=True)

    sni: Mapped[str] = mapped_column(String(255))
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    port: Mapped[int] = mapped_column(Integer)
    fingerprint: Mapped[str] = mapped_column(String(32))

    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    delay_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    up_bps: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    down_bps: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)
