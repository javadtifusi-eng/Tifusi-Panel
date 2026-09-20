import enum
import secrets
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


XRAY_VERSION_MAX_LENGTH = 32


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

    # Which Core this node runs — sync_node() pushes that Core's raw Xray
    # JSON with clients injected per inbound (see app/xray_config/builder.py).
    core_id: Mapped[int | None] = mapped_column(ForeignKey("cores.id"), nullable=True)

    # A second, independent slot: an l2tp/ikev2 Core this same node's agent
    # also manages via strongSwan/xl2tpd, at the same time as the Xray
    # process above — one physical node can serve both without needing two
    # servers. Kept separate from core_id (not a list) because a node's
    # agent can only ever run one Xray process and one IPsec stack, never
    # several of either.
    ipsec_core_id: Mapped[int | None] = mapped_column(ForeignKey("cores.id"), nullable=True)

    # A third slot, for the same reason as the second: the agent runs
    # `hysteria server` as another subprocess beside Xray and the IPsec stack,
    # so one node can serve all three at once. One per node, not a list —
    # a second Hysteria2 server would need a second UDP port and there is no
    # reason to run two on one machine.
    hysteria_core_id: Mapped[int | None] = mapped_column(ForeignKey("cores.id"), nullable=True)

    # Optional chained egress for this node's L2TP clients: a vless:// share
    # link to a *different* panel's server. When set, the node agent stops
    # NAT'ing l2tp traffic straight to the internet and instead runs a
    # second, isolated Xray process whose only outbound is that link, and
    # TPROXYs the l2tp subnet into it — the far VLESS server becomes the
    # real egress point instead of this node itself. Null keeps today's
    # plain-NAT behavior.
    l2tp_egress_vless: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    status: Mapped[NodeStatus] = mapped_column(Enum(NodeStatus, native_enum=False, length=16), default=NodeStatus.pending)
    xray_version: Mapped[str | None] = mapped_column(String(XRAY_VERSION_MAX_LENGTH), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
