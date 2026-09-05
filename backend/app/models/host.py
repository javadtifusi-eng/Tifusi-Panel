import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.group import group_hosts


class HostProtocol(str, enum.Enum):
    vless = "vless"
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
    __tablename__ = "hosts"

    id: Mapped[int] = mapped_column(primary_key=True)
    remark: Mapped[str] = mapped_column(String(100))
    protocol: Mapped[HostProtocol] = mapped_column(Enum(HostProtocol))
    address: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)

    # Only meaningful for vless/trojan; wireguard/hysteria2 have their own transport.
    network: Mapped[HostNetwork | None] = mapped_column(Enum(HostNetwork), nullable=True)
    security: Mapped[HostSecurity | None] = mapped_column(Enum(HostSecurity), nullable=True)
    sni: Mapped[str | None] = mapped_column(String(255), nullable=True)

    reality_public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reality_private_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reality_short_id: Mapped[str | None] = mapped_column(String(16), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Empty = global/ungrouped, visible and usable by every user. See app/groups/access.py.
    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=group_hosts, back_populates="hosts", lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]
