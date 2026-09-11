import enum
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.database import Base


class TunnelTransport(str, enum.Enum):
    tcp = "tcp"
    tls = "tls"
    ws = "ws"
    wss = "wss"
    tcpmux = "tcpmux"
    wsmux = "wsmux"
    wssmux = "wssmux"
    udp = "udp"


class TunnelStatus(str, enum.Enum):
    pending = "pending"  # created, never tested
    connected = "connected"
    error = "error"


class Tunnel(Base):
    """A reverse tunnel published through an Iran server for a VPN server
    abroad — the actual relay (backend/tunnel_agent/) runs as its own Go
    binary on both ends, installed by hand via the command this row's
    fields generate; the panel never talks to it as a managed agent the
    way it does a Node's node_agent. This row is just the source of truth
    for that config so the admin isn't retyping a token/port map by hand
    on both servers, plus a lightweight reachability check."""

    __tablename__ = "tunnels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))

    # The Iran side owns the public listener — everything a client connects
    # to goes through here.
    iran_address: Mapped[str] = mapped_column(String(255))
    iran_port: Mapped[int] = mapped_column(Integer, default=8443)

    # The foreign side either points at a Node we already manage (its
    # address is reused, so it isn't typed twice) or a bare address for a
    # server this panel doesn't otherwise know about.
    foreign_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id"), nullable=True)
    foreign_address: Mapped[str | None] = mapped_column(String(255), nullable=True)

    transport: Mapped[TunnelTransport] = mapped_column(Enum(TunnelTransport))
    token: Mapped[str] = mapped_column(String(64), default=lambda: secrets.token_hex(16))

    # Only meaningful for tls/wss/wssmux — plain tcp/ws/tcpmux/wsmux/udp
    # ignore these (the Go binary itself ignores fields a transport
    # doesn't use, so leaving them populated in the stored config for a
    # tunnel that later switches transport is harmless).
    sni: Mapped[str | None] = mapped_column(String(255), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Only meaningful for ws/wss/wsmux/wssmux.
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # "Pool" (plain transports) and "mux_con" (mux transports) are the same
    # underlying idea — how many physical connections the foreign side
    # keeps warm — so one field covers both rather than making the admin
    # pick between two identically-shaped inputs depending on transport.
    connection_count: Mapped[int] = mapped_column(Integer, default=8)

    # [{"name": str, "listen_port": int, "net": "tcp"|"udp", "target_port": int}, ...]
    forwards: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    status: Mapped[TunnelStatus] = mapped_column(Enum(TunnelStatus), default=TunnelStatus.pending)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
