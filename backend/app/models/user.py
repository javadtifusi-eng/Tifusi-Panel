import enum
import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.group import group_users


class UserStatus(str, enum.Enum):
    active = "active"
    disabled = "disabled"
    expired = "expired"
    limited = "limited"
    on_hold = "on_hold"


class ProxyUser(Base):
    __tablename__ = "proxy_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus), default=UserStatus.active)

    # Doubles as the VLESS UUID, the Trojan/Hysteria2 password, and the
    # unguessable token in this user's subscription URL.
    secret: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, default=lambda: str(uuid_lib.uuid4())
    )

    # None/0 means unlimited.
    data_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    used_traffic: Mapped[int] = mapped_column(BigInteger, default=0)

    # None/0 means data_limit is a one-time cap (existing behavior — once
    # hit, the user stays `limited` until an admin steps in). Set to a
    # number of days and app/traffic/sync.py zeroes used_traffic back out
    # (and reactivates a `limited` user) every time that many days pass
    # since data_limit_reset_at, which advances by the same interval on
    # every reset rather than snapping to "now" — a user who reset a day
    # late still resets on their original schedule, not a day later too.
    data_limit_reset_days: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    data_limit_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    expire: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Only meaningful while status == on_hold: how many days to give the
    # user once their expire clock actually starts (their first
    # subscription fetch — see app/routers/subscription.py), instead of
    # from the moment an admin creates the account. None while on_hold
    # means "no expiry once activated", same as expire=None normally does.
    on_hold_expire_days: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # None/0 means unlimited devices — see app/models/user_device.py and
    # the enforcement in app/routers/subscription.py.
    hwid_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # None means uncapped. NOT YET ENFORCED — recorded and shown in the UI
    # only. Vanilla Xray-core has no native per-client bandwidth-cap field
    # (its policy levels cover handshake/connIdle timeouts and stats, not
    # throughput), and this panel's data plane doesn't tag which kernel
    # connection belongs to which user, so there's nothing today for a
    # node-side `tc`/cgroup shaper to key off of. Real enforcement needs
    # that per-connection tagging built first — see node_agent/main.py's
    # /config, which would need to pass this through once it exists.
    speed_limit_mbps: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Bumped in app/traffic/sync.py::collect_traffic whenever a poll cycle
    # (every app.config.settings.traffic_sync_interval_seconds, 30s by
    # default) sees a nonzero traffic delta for this user — "last seen
    # active within the last poll window", not a live push-based signal.
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Which admin created this user — a non-owner admin only ever sees/
    # manages users where this matches their own id (reseller-style
    # isolation between admins); the owner always sees everyone regardless.
    # NULL only happens for rows that existed before this column did.
    admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Empty = no restriction beyond global (ungrouped) hosts. See app/groups/access.py.
    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=group_users, back_populates="users", lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]
