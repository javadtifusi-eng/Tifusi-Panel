from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserDevice(Base):
    """One row per distinct device that has fetched a user's subscription —
    the panel's own device-limit enforcement (see app/routers/subscription.py),
    not something reported by a node agent. A device is identified by
    whatever the client sends as `?hwid=` if it sends anything (some client
    apps do), otherwise the requesting IP address — either way it's recorded
    at the moment the subscription link is fetched, which is the only place
    this panel can actually observe "a new device is using this account"
    without needing every node to report per-connection identity."""

    __tablename__ = "user_devices"
    __table_args__ = (UniqueConstraint("user_id", "identifier", name="uq_user_device"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("proxy_users.id", ondelete="CASCADE"), index=True)
    identifier: Mapped[str] = mapped_column(String(128))
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
