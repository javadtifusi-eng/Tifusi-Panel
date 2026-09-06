import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.group import group_hosts


class HostProtocol(str, enum.Enum):
    vless = "vless"
    vmess = "vmess"
    trojan = "trojan"
    wireguard = "wireguard"
    hysteria2 = "hysteria2"


class HostNetwork(str, enum.Enum):
    tcp = "tcp"
    ws = "ws"
    grpc = "grpc"


class HostSecurity(str, enum.Enum):
    none = "none"
    tls = "tls"
    reality = "reality"


class Host(Base):
    """A presentation-layer entry: an address/port a client actually connects
    to. Everything about *how* it speaks (protocol, transport, security,
    REALITY/WireGuard keys, fingerprint, ALPN) comes from its Core instead —
    a Host just picks one and optionally overrides a couple of per-instance
    details (port, SNI/ALPN target) on top of it. See app/models/core.py."""

    __tablename__ = "hosts"

    id: Mapped[int] = mapped_column(primary_key=True)
    remark: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(255))

    # None = use the Core's default_port.
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Per-host overrides of the Core's own sni/alpn — leave unset to just
    # inherit the Core's value. Useful for spreading several REALITY targets
    # across hosts that otherwise share one Core's protocol/transport/keys.
    sni_override: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alpn_override: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    core_id: Mapped[int] = mapped_column(ForeignKey("cores.id"))
    core: Mapped["Core"] = relationship("Core", lazy="selectin")  # noqa: F821

    # Empty = global/ungrouped, visible and usable by every user. See app/groups/access.py.
    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=group_hosts, back_populates="hosts", lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]

    # --- Everything below just reads through to the Core. Kept as
    # properties (same names builder.py/generator.py/wireguard/* used before
    # this fields-moved-to-Core redesign) so that code didn't have to change
    # at every call site — only the handful of places that need the
    # override-aware *effective_* value do.

    @property
    def protocol(self) -> HostProtocol:
        return self.core.protocol

    @property
    def network(self) -> HostNetwork | None:
        return self.core.network

    @property
    def security(self) -> HostSecurity | None:
        return self.core.security

    @property
    def fingerprint(self) -> str | None:
        return self.core.fingerprint

    @property
    def path(self) -> str | None:
        return self.core.path

    @property
    def host_header(self) -> str | None:
        return self.core.host_header

    @property
    def reality_public_key(self) -> str | None:
        return self.core.reality_public_key

    @property
    def reality_private_key(self) -> str | None:
        return self.core.reality_private_key

    @property
    def reality_short_id(self) -> str | None:
        return self.core.reality_short_id

    @property
    def wireguard_public_key(self) -> str | None:
        return self.core.wireguard_public_key

    @property
    def wireguard_private_key(self) -> str | None:
        return self.core.wireguard_private_key

    @property
    def wireguard_subnet(self) -> str | None:
        return self.core.wireguard_subnet

    @property
    def effective_port(self) -> int | None:
        return self.port if self.port is not None else self.core.default_port

    @property
    def effective_sni(self) -> str | None:
        return self.sni_override if self.sni_override is not None else self.core.sni

    @property
    def effective_alpn(self) -> str | None:
        return self.alpn_override if self.alpn_override is not None else self.core.alpn
