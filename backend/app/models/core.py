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
    hysteria2 = "hysteria2"


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
    - hysteria2: a server the panel *does* run, the same way it runs Xray —
      the node agent is handed this config and starts `hysteria server` as
      its own subprocess. Before this existed, a hysteria2 Host carried the
      port and obfuscation password itself and nothing pushed them anywhere,
      so the panel's idea of a server and the YAML file actually running on
      the machine could drift apart silently: change the obfuscation
      password here without editing that file and every link breaks with no
      error. As a Core, one edit reaches both.
    """

    __tablename__ = "cores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # native_enum=False keeps this a VARCHAR on every database (as the
    # migrations created it), so MySQL doesn't get a native ENUM that would
    # need an ALTER every time a value is added.
    core_type: Mapped[CoreType] = mapped_column(Enum(CoreType, native_enum=False, length=16))
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

    # "eap" (default): the modes above, one login per ProxyUser. "psk":
    # drop the certificate and EAP entirely for one shared secret (this
    # Core's ikev2_psk) with no per-user login at all — for networks whose
    # filtering targets the IKE certificate exchange itself rather than
    # IKEv2 traffic in general (see node_agent/ipsec.py for how this was
    # found). Native iOS/Windows "Shared Secret" IKEv2 setup has no
    # username/password field, so every user of the Host shares one secret.
    ikev2_auth_mode: Mapped[str] = mapped_column(String(16), default="eap", server_default="eap")

    # Optional chained egress for this Core's IKEv2 clients: a vless://
    # share link to a *different* panel's server — same idea and same
    # node_agent/vless_egress.py machinery as Node.l2tp_egress_vless (see
    # app/models/node.py), just keyed off the IKEv2 Core instead of the
    # Node, since unlike l2tp a node can serve more than one IKEv2 Core's
    # worth of hosts and each one may want a different (or no) exit. When
    # set, the node stops NAT'ing the IKEv2 subnet straight to the internet
    # and instead TPROXYs it into a second, isolated Xray process whose
    # only outbound is that link — the far VLESS server becomes the real
    # egress point. Null keeps today's plain-NAT behavior.
    ikev2_egress_vless: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # --- hysteria2 only ---
    # The UDP port, which on an Iranian mobile operator is not a detail but the
    # single biggest lever there is: measured from one MCI phone with everything
    # else held constant, a random high port was poor, UDP 443 answered nothing
    # at all, port 53 capped the download near 3 Mbps, and 8801 (Zoom's media
    # port) reached 40 — because the operator cannot police the class of traffic
    # its own subscribers' video calls live in. See docs/en/hysteria2.md.
    hysteria2_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Salamander password. Without it the first packet on the wire is a plain
    # QUIC handshake, which Iranian networks drop wholesale, so a server that
    # works from anywhere else is unreachable from inside Iran for that reason
    # alone. Shared by every user of this Core: it hides the shape of the
    # traffic and identifies nobody — each user's own secret does that.
    hysteria2_obfs: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Megabits per second the node is allowed to send out of that port, or None
    # for no limit. This exists because raw throughput turned out to be the wrong
    # thing to maximise: on the same phone, 40 Mbps on this port felt *worse* to
    # use than 3 Mbps on port 53, since a mobile radio link buffers deeply and
    # filling that buffer cost 300-500 ms of latency. Capping well below the
    # ceiling keeps the queue empty, which is what decides whether a page opens
    # now or in three seconds. The agent applies it with tc on its own egress.
    hysteria2_rate_mbps: Mapped[int | None] = mapped_column(Integer, nullable=True)

    inbounds: Mapped[list["Inbound"]] = relationship(  # noqa: F821
        "Inbound", back_populates="core", cascade="all, delete-orphan", lazy="selectin"
    )
