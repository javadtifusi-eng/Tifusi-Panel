from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WireGuardPeer(Base):
    """One row per (host, user): the client keypair and tunnel IP handed to
    that user on that WireGuard host. Generated once on first request and
    reused after that, so re-opening the links modal doesn't hand out a new
    IP or orphan the old one on the server's peer list."""

    __tablename__ = "wireguard_peers"
    __table_args__ = (UniqueConstraint("host_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("hosts.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("proxy_users.id", ondelete="CASCADE"))

    private_key: Mapped[str] = mapped_column(String(64))
    public_key: Mapped[str] = mapped_column(String(64))
    address: Mapped[str] = mapped_column(String(15))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
