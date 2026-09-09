from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ApiKey(Base):
    """A long-lived credential an admin can hand to a script/bot instead of
    logging in for a short-lived JWT session token. Resolves straight to
    its owning Admin row on every request (see app.dependencies.
    get_current_admin) — not a permissions snapshot, so a key's effective
    access always tracks whatever its admin can currently do, the same way
    the JWT path already works."""

    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("admins.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))

    # sha256 hex digest of the raw key — the raw key itself is shown to the
    # admin exactly once, at creation, and never stored or displayed again.
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # First chars of the raw key (unhashed) so the admin can tell keys
    # apart in the list without ever seeing the rest of a key again.
    key_prefix: Mapped[str] = mapped_column(String(24))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
