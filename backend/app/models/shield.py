import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.database import Base


class ShieldMode(str, enum.Enum):
    # Cloudflare record points at the active relay; clients keep the same
    # address and follow the record, no subscription update needed.
    dns = "dns"
    # Every Host whose address is one of the group's relays is rewritten to
    # the active one; clients pick it up on their next subscription update.
    hosts = "hosts"


class ShieldGroup(Base):
    """Connection Shield: a set of interchangeable Iran relays (Tunnels) for
    the same foreign server. The panel probes each relay's public listener
    from abroad; when the active one stops answering — Iran-access or plain
    downtime look the same from outside, and both call for the same move —
    clients are moved to the next healthy relay. See app/shield/engine.py."""

    __tablename__ = "shield_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    mode: Mapped[ShieldMode] = mapped_column(Enum(ShieldMode, native_enum=False, length=16))

    dns_record: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cloudflare_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Looked up from dns_record on first use and kept, so the token only
    # needs DNS edit rights, not a zone ID typed in by hand.
    cloudflare_zone_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Consecutive failed checks before a relay counts as burnt; also the
    # consecutive successes a burnt relay needs before it becomes a
    # standby again.
    fail_threshold: Mapped[int] = mapped_column(Integer, default=3)

    # Deliberately not a foreign key: tunnels already reference this table
    # through shield_members, and a cycle would make both deletes awkward.
    # A dangling id is treated as "no active relay" by the engine.
    active_tunnel_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stranded: Mapped[bool] = mapped_column(Boolean, default=False)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ShieldMember(Base):
    __tablename__ = "shield_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("shield_groups.id", ondelete="CASCADE"), index=True)
    # Unique: one relay can't be the fallback of two groups at once, or a
    # switch in one would silently move the other's clients too.
    tunnel_id: Mapped[int] = mapped_column(ForeignKey("tunnels.id", ondelete="CASCADE"), unique=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    burnt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fail_streak: Mapped[int] = mapped_column(Integer, default=0)
    ok_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ShieldEvent(Base):
    """What happened, stored as a kind plus parameters rather than a
    sentence, so the dashboard can show it in either language."""

    __tablename__ = "shield_events"
    __table_args__ = (Index("ix_shield_events_group_id_id", "group_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("shield_groups.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
