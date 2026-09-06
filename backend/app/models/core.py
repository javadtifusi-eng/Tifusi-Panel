from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.host import HostNetwork, HostProtocol, HostSecurity

DEFAULT_CORE_NAME = "Default Core"


class Core(Base):
    """A named, reusable "how do I speak" template: protocol, transport,
    security, and everything that goes with them (REALITY/WireGuard keys,
    fingerprint, ALPN, SNI). A Host is just an address/port that picks one
    Core — that's the only place protocol/transport/security lives now, not
    on the Host itself. A node only ever receives the hosts sharing its own
    Core, so separate Cores can run entirely different combos side by side
    (e.g. a VLESS+REALITY core and a WireGuard-only core)."""

    __tablename__ = "cores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    protocol: Mapped[HostProtocol | None] = mapped_column(Enum(HostProtocol), nullable=True)
    # Only meaningful for vless/vmess/trojan; wireguard/hysteria2 have their own transport.
    network: Mapped[HostNetwork | None] = mapped_column(Enum(HostNetwork), nullable=True)
    security: Mapped[HostSecurity | None] = mapped_column(Enum(HostSecurity), nullable=True)
    # The port a Host under this Core gets if it doesn't set its own.
    default_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    sni: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Client-side uTLS fingerprint (chrome/firefox/safari/ios/android/edge/
    # random/randomized/...) — Xray's REALITY/TLS server config doesn't take
    # this, it only ever goes into the client link (app/links/generator.py).
    fingerprint: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # TLS/REALITY ALPN list, comma-separated (e.g. "h2,http/1.1").
    alpn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # WebSocket request path / gRPC serviceName, depending on `network`.
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # WebSocket HTTP Host header — lets hosts under this Core sit behind a
    # CDN/domain different from their own `address`.
    host_header: Mapped[str | None] = mapped_column(String(255), nullable=True)

    reality_public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reality_private_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reality_short_id: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Only meaningful for protocol=wireguard. These are the *server's* own
    # keypair; each user additionally gets their own peer keypair + IP,
    # allocated lazily and stored in WireGuardPeer (see app/wireguard/).
    wireguard_public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wireguard_private_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wireguard_subnet: Mapped[str | None] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
