from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


class Core(Base):
    """A real Xray config the admin pastes/uploads whole — the actual
    `inbounds` array with real protocol/streamSettings, exactly what
    `xray run -c` would take. This panel never templates or synthesizes it:
    every inbound's protocol/transport/security/REALITY keys/flow live in
    this JSON. Parsed out into Inbound rows (app/models/inbound.py) purely
    for the panel's own bookkeeping — which tags exist, what a Host can
    pick, what a Group can grant."""

    __tablename__ = "cores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    inbounds: Mapped[list["Inbound"]] = relationship(  # noqa: F821
        "Inbound", back_populates="core", cascade="all, delete-orphan", lazy="selectin"
    )
