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
    spoof = "spoof"


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

    # Probe-only: the foreign side dials out, so it never listens on a
    # tunnel port of its own and there is nothing tunnel-specific to check
    # there. This is just "is that box alive" — a Node reuses its agent
    # port, a bare address needs a port the admin knows is open (SSH by
    # default, but that is a guess worth overriding).
    foreign_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    transport: Mapped[TunnelTransport] = mapped_column(Enum(TunnelTransport, native_enum=False, length=16))
    token: Mapped[str] = mapped_column(String(64), default=lambda: secrets.token_hex(16))

    # Only meaningful for tls/wss/wssmux — plain tcp/ws/tcpmux/wsmux/udp
    # ignore these (the Go binary itself ignores fields a transport
    # doesn't use, so leaving them populated in the stored config for a
    # tunnel that later switches transport is harmless).
    sni: Mapped[str | None] = mapped_column(String(255), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Only meaningful for ws/wss/wsmux/wssmux.
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Only meaningful for the "spoof" transport: the forged source IPv4(s) both
    # sides stamp on their outbound packets so they pass L3 egress filtering
    # during national-internet mode. It must be an address the filter
    # allow-lists — measured first with the spooftest probe. Each side sends
    # to the OTHER's real address (iran_address / foreign_address), so there
    # is no separate peer field to store.
    spoof_source: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Only meaningful for the "spoof" transport: the L4 protocol the forged
    # packets pretend to be — "udp" (default), "icmp" or "tcp". The spoofing
    # is identical for all three; the carrier only changes what a filter or
    # DPI box sees, so a link that throttles UDP may still pass ICMP or
    # fake-TCP. Both sides use the same value (the config builder stamps it on
    # each side). NULL is treated as "udp" for tunnels created before carriers
    # existed.
    spoof_carrier: Mapped[str | None] = mapped_column(String(8), nullable=True)

    # Set when the foreign side reaches the relay through a CDN. The foreign
    # side then dials cdn_host:cdn_port instead of iran_address, which stays
    # the address users connect to; the CDN forwards WebSocket traffic to
    # the relay's own port. ArvanCloud's edges inside Iran mean the relay
    # only ever talks to domestic addresses. See app/routers/tunnels.py.
    cdn_provider: Mapped[str | None] = mapped_column(String(16), nullable=True)  # arvan | cloudflare
    cdn_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cdn_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Clean edge IPs the foreign side dials instead of resolving cdn_host
    # (best first; connections are spread across them), and an optional
    # front SNI — another site on the same CDN — for domain fronting.
    cdn_ips: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    cdn_front: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # "Pool" (plain transports) and "mux_con" (mux transports) are the same
    # underlying idea — how many physical connections the foreign side
    # keeps warm — so one field covers both rather than making the admin
    # pick between two identically-shaped inputs depending on transport.
    connection_count: Mapped[int] = mapped_column(Integer, default=8)

    # [{"name": str, "listen_port": int, "net": "tcp"|"udp", "target_port": int}, ...]
    forwards: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    status: Mapped[TunnelStatus] = mapped_column(Enum(TunnelStatus, native_enum=False, length=16), default=TunnelStatus.pending)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
