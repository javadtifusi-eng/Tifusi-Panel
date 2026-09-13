from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppReport(Base):
    """One connection attempt (or subscription fetch) as reported by the
    Tifusi VPN Android app itself via POST /app/report (see
    app/routers/app_reports.py). This is the only view the panel gets of
    what happened on the phone's side — a failed IKEv2 handshake on a
    particular carrier never reaches a node's logs in a form tied to a
    user — so admins can see why "it doesn't connect" without asking the
    customer for screenshots.

    Everything but user_id, received_at and client_ip is self-reported by
    the app and untrusted: display it, never act on it. Capped per user
    (see _KEEP_PER_USER in the router) so a chatty or misbehaving client
    can't grow the database without bound."""

    __tablename__ = "app_reports"
    __table_args__ = (Index("ix_app_reports_user_id_received_at", "user_id", "received_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("proxy_users.id", ondelete="CASCADE"))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    client_ip: Mapped[str] = mapped_column(String(64))

    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    android_sdk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    device: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # The device's own clock at the time of the event, which can be well
    # before received_at — the app queues reports while it has no working
    # connection, which is exactly when they're most interesting.
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    event: Mapped[str] = mapped_column(String(32))
    result: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str | None] = mapped_column(String(500), nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    network: Mapped[str | None] = mapped_column(String(32), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sim_carrier: Mapped[str | None] = mapped_column(String(100), nullable=True)
