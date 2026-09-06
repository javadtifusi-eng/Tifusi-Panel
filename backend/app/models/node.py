import enum
import secrets
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class NodeStatus(str, enum.Enum):
    pending = "pending"  # registered, never successfully synced
    connected = "connected"
    error = "error"


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer, default=62050)
    api_key: Mapped[str] = mapped_column(String(64), default=lambda: secrets.token_urlsafe(24))

    # Which Core this node runs — sync_node() only pushes hosts sharing this core_id.
    core_id: Mapped[int | None] = mapped_column(ForeignKey("cores.id"), nullable=True)

    status: Mapped[NodeStatus] = mapped_column(Enum(NodeStatus), default=NodeStatus.pending)
    xray_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
