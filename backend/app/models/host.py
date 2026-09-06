import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.group import group_hosts


class HostProtocol(str, enum.Enum):
    vless = "vless"
    vmess = "vmess"
    trojan = "trojan"
    shadowsocks = "shadowsocks"
    wireguard = "wireguard"
    hysteria2 = "hysteria2"
    ikev2 = "ikev2"
    l2tp = "l2tp"


# Protocols Xray-core itself terminates — these are the ones backed by an
# Inbound (parsed out of a Core's real Xray JSON, see app/models/inbound.py).
XRAY_PROTOCOLS = {HostProtocol.vless, HostProtocol.vmess, HostProtocol.trojan, HostProtocol.shadowsocks}

# Standalone servers this panel doesn't run itself — a Host just picks a
# Core of the matching core_type, which holds the shared technical fields
# (keys/PSK/port/subnet) once instead of repeating them per Host.
CORE_LINKED_PROTOCOLS = {HostProtocol.wireguard, HostProtocol.l2tp, HostProtocol.ikev2}

FINGERPRINTS = (
    "chrome",
    "firefox",
    "safari",
    "ios",
    "android",
    "edge",
    "360",
    "qq",
    "random",
    "randomized",
    "randomizednoalpn",
    "unsafe",
)


class HostSecurity(str, enum.Enum):
    none = "none"
    tls = "tls"
    reality = "reality"


class Host(Base):
    """A presentation-layer entry: an address a client actually connects to.

    For vless/vmess/trojan/shadowsocks, a Host just picks an Inbound (which
    carries the real protocol/network/security/REALITY keys/flow, parsed
    from its Core's Xray JSON — see app/models/inbound.py) and may layer a
    handful of client-facing overrides on top (SNI, ALPN, fingerprint,
    path, security, allowinsecure). Nothing about *how* the proxy actually
    runs lives on the Host for these — that's the Inbound's JSON.

    wireguard/l2tp/ikev2 aren't Xray inbounds at all (separate standalone
    servers this panel doesn't start) — a Host for these just picks a Core
    of the matching core_type (see app/models/core.py), which holds the
    shared fields. hysteria2 is the one exception: no Core concept for it
    yet, so it still keeps its own fields directly on the Host.
    """

    __tablename__ = "hosts"

    id: Mapped[int] = mapped_column(primary_key=True)
    remark: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(255))
    protocol: Mapped[HostProtocol] = mapped_column(Enum(HostProtocol))

    # --- vless/vmess/trojan/shadowsocks: Inbound + overrides ---
    inbound_id: Mapped[int | None] = mapped_column(ForeignKey("inbounds.id"), nullable=True)
    inbound: Mapped["Inbound | None"] = relationship("Inbound", back_populates="hosts", lazy="selectin")  # noqa: F821

    port_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sni_override: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alpn_override: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fingerprint_override: Mapped[str | None] = mapped_column(String(32), nullable=True)
    path_override: Mapped[str | None] = mapped_column(String(255), nullable=True)
    host_header_override: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # None = inherit the Inbound's own security (its streamSettings.security).
    security_override: Mapped[HostSecurity | None] = mapped_column(Enum(HostSecurity), nullable=True)
    allowinsecure: Mapped[bool] = mapped_column(default=False)

    # --- wireguard/l2tp/ikev2: which Core (of the matching core_type)
    # this Host is built on — that Core holds the actual keys/PSK/port/subnet.
    core_id: Mapped[int | None] = mapped_column(ForeignKey("cores.id"), nullable=True)
    core: Mapped["Core | None"] = relationship("Core", lazy="selectin")  # noqa: F821

    # --- hysteria2 only ---
    hysteria2_sni: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hysteria2_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Empty = global/ungrouped, visible and usable by every user. See app/groups/access.py.
    # For xray-backed hosts, access is really controlled at the Inbound level
    # (a Group grants access to Inbounds) — this direct Host<->Group link only
    # matters for wireguard/hysteria2 hosts, which have no Inbound to grant.
    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=group_hosts, back_populates="hosts", lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]

    # --- Effective (override-aware) values, reading through to the Inbound
    # for xray-backed hosts. Only meaningful when self.inbound is set.

    @property
    def network(self) -> str | None:
        return self.inbound.network if self.inbound else None

    @property
    def effective_security(self) -> str | None:
        if self.security_override is not None:
            return self.security_override.value
        return self.inbound.security if self.inbound else None

    @property
    def effective_port(self) -> int | None:
        if self.protocol == HostProtocol.wireguard:
            return self.core.wireguard_port if self.core else None
        if self.protocol == HostProtocol.hysteria2:
            return self.hysteria2_port
        if self.port_override is not None:
            return self.port_override
        return self.inbound.port if self.inbound else None

    @property
    def effective_sni(self) -> str | None:
        if self.protocol == HostProtocol.hysteria2:
            return self.hysteria2_sni
        if self.sni_override is not None:
            return self.sni_override
        return self.inbound.sni if self.inbound else None

    @property
    def effective_alpn(self) -> str | None:
        if self.alpn_override is not None:
            return self.alpn_override
        return self.inbound.alpn if self.inbound else None

    @property
    def effective_fingerprint(self) -> str | None:
        if self.fingerprint_override is not None:
            return self.fingerprint_override
        return self.inbound.fingerprint if self.inbound else None

    @property
    def effective_path(self) -> str | None:
        if self.path_override is not None:
            return self.path_override
        return self.inbound.path if self.inbound else None

    @property
    def effective_host_header(self) -> str | None:
        if self.host_header_override is not None:
            return self.host_header_override
        return self.inbound.host_header if self.inbound else None
