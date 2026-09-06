from sqlalchemy import Column, ForeignKey, Integer, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

group_inbounds = Table(
    "group_inbounds",
    Base.metadata,
    Column("group_id", ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
    Column("inbound_id", ForeignKey("inbounds.id", ondelete="CASCADE"), primary_key=True),
)


class Inbound(Base):
    """One entry per `tag` found inside a Core's raw Xray JSON — the panel's
    own bookkeeping row, not a second source of truth. Everything here is
    parsed straight out of that JSON (app/xray_config/inbound_parser.py) and
    re-synced every time the Core is saved (app/cores/sync.py); a Host never
    sets any of these fields itself, it only picks an Inbound and layers a
    couple of client-facing overrides on top (see app/models/host.py)."""

    __tablename__ = "inbounds"

    id: Mapped[int] = mapped_column(primary_key=True)
    tag: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    core_id: Mapped[int] = mapped_column(ForeignKey("cores.id", ondelete="CASCADE"))
    core: Mapped["Core"] = relationship("Core", back_populates="inbounds")  # noqa: F821

    protocol: Mapped[str] = mapped_column(String(32))
    network: Mapped[str] = mapped_column(String(32), default="tcp")
    security: Mapped[str] = mapped_column(String(16), default="none")
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    encryption: Mapped[str | None] = mapped_column(String(32), nullable=True)
    flow: Mapped[str | None] = mapped_column(String(32), nullable=True)
    header_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    host_header: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sni: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alpn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fingerprint: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reality_public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reality_short_id: Mapped[str | None] = mapped_column(String(16), nullable=True)

    hosts: Mapped[list["Host"]] = relationship(  # noqa: F821
        "Host", back_populates="inbound", lazy="selectin"
    )
    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=group_inbounds, back_populates="inbounds", lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]
