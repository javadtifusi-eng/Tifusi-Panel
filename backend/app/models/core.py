from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

DEFAULT_CORE_NAME = "Default Core"


class Core(Base):
    """A named Xray-core config profile. Each host and node picks one Core —
    a node only ever receives the config built from hosts sharing its Core,
    so separate Cores can run entirely different protocol/transport combos
    side by side (e.g. a VLESS+REALITY core and a WireGuard-only core)."""

    __tablename__ = "cores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
