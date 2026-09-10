import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Enum, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


class CoreType(str, enum.Enum):
    xray = "xray"
    l2tp = "l2tp"
    ikev2 = "ikev2"


class Core(Base):
    """A server-side technology a Host presents to clients. Exactly one of
    the field groups below is meaningful, picked by `core_type`:

    - xray: a real Xray config the admin pastes/uploads whole — the actual
      `inbounds` array with real protocol/streamSettings, exactly what
      `xray run -c` would take. Never templated or synthesized; parsed out
      into Inbound rows (app/models/inbound.py) purely for the panel's own
      bookkeeping — which tags exist, what a Host can pick, what a Group
      can grant.
    - l2tp/ikev2: standalone servers this panel doesn't run itself (the
      admin already has strongSwan/xl2tpd set up) — just the shared
      technical fields every Host built on this Core needs, so they're
      entered once instead of repeated per Host.
    """

    __tablename__ = "cores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    core_type: Mapped[CoreType] = mapped_column(Enum(CoreType))
    config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # --- l2tp only: shared IPsec PSK; ports are the protocol's fixed
    # standard UDP 500/1701/4500 ---
    l2tp_psk: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- ikev2 only: shared IPsec PSK plus an optional IKE remote
    # identity; ports are the protocol's fixed standard UDP 500/4500 ---
    ikev2_psk: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ikev2_remote_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Server certificate for IKEv2's local `auth = pubkey` round (see
    # node_agent/ipsec.py). Both null: the node self-signs one, CN/SAN'd off
    # ikev2_remote_id, on every apply. Set: this exact PEM pair is pushed
    # and used verbatim instead — for a real CA-issued cert (e.g. Let's
    # Encrypt, once the node has a domain), which needs no client-side CA
    # trust step, unlike the node's self-signed fallback.
    ikev2_certificate: Mapped[str | None] = mapped_column(Text, nullable=True)
    ikev2_certificate_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    inbounds: Mapped[list["Inbound"]] = relationship(  # noqa: F821
        "Inbound", back_populates="core", cascade="all, delete-orphan", lazy="selectin"
    )
