from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# wireguard/hysteria2 hosts have no Inbound to grant access through, so they
# keep a direct Group<->Host link. vless/vmess/trojan/shadowsocks hosts are
# gated through group_inbounds instead (see app/models/inbound.py) — a Group
# grants whole Inbounds, and every Host under a granted Inbound becomes
# visible, matching PasarGuard's actual access model.
group_hosts = Table(
    "group_hosts",
    Base.metadata,
    Column("group_id", ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
    Column("host_id", ForeignKey("hosts.id", ondelete="CASCADE"), primary_key=True),
)

group_users = Table(
    "group_users",
    Base.metadata,
    Column("group_id", ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", ForeignKey("proxy_users.id", ondelete="CASCADE"), primary_key=True),
)


class Group(Base):
    """Bundles inbounds/wireguard+hysteria2 hosts and users together. An
    inbound or standalone host with no group is global (visible to every
    user); once it joins a group, only users sharing that group can see or
    actually use it — see app/groups/access.py."""

    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    inbounds: Mapped[list["Inbound"]] = relationship(  # noqa: F821
        "Inbound", secondary="group_inbounds", back_populates="groups", lazy="selectin"
    )
    hosts: Mapped[list["Host"]] = relationship(  # noqa: F821
        "Host", secondary=group_hosts, back_populates="groups", lazy="selectin"
    )
    users: Mapped[list["ProxyUser"]] = relationship(  # noqa: F821
        "ProxyUser", secondary=group_users, back_populates="groups", lazy="selectin"
    )

    @property
    def inbound_ids(self) -> list[int]:
        return [i.id for i in self.inbounds]

    @property
    def host_ids(self) -> list[int]:
        return [h.id for h in self.hosts]

    @property
    def user_ids(self) -> list[int]:
        return [u.id for u in self.users]
