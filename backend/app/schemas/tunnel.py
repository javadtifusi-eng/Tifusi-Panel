from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.tunnel import TunnelStatus, TunnelTransport

ForwardNet = Literal["tcp", "udp"]
CdnProvider = Literal["arvan", "cloudflare"]
SpoofCarrier = Literal["auto", "udp", "icmp", "tcp"]


class TunnelForward(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    listen_port: int = Field(ge=1, le=65535)
    net: ForwardNet
    target_port: int = Field(ge=1, le=65535)


class TunnelCreate(BaseModel):
    # A stray space pasted with an address ends up in the agent config as
    # "1.2.3.4 :8443", which the foreign side can't resolve.
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    iran_address: str = Field(min_length=1, max_length=255)
    iran_port: int = Field(default=8443, ge=1, le=65535)
    foreign_node_id: int | None = None
    foreign_address: str | None = Field(default=None, max_length=255)
    foreign_port: int | None = Field(default=None, ge=1, le=65535)
    transport: TunnelTransport
    sni: str | None = Field(default=None, max_length=255)
    domain: str | None = Field(default=None, max_length=255)
    path: str | None = Field(default=None, max_length=255)
    spoof_source: str | None = Field(default=None, max_length=64)
    spoof_carrier: SpoofCarrier | None = None
    spoof_stealth: bool | None = None
    connection_count: int = Field(default=8, ge=1, le=256)
    # The Iran side refuses to start without a forward, so catch it here.
    forwards: list[TunnelForward] = Field(min_length=1)
    cdn_provider: CdnProvider | None = None
    cdn_host: str | None = Field(default=None, max_length=255)
    cdn_port: int | None = Field(default=None, ge=1, le=65535)
    cdn_ips: list[str] = Field(default=[], max_length=5)
    cdn_front: str | None = Field(default=None, max_length=255)


class TunnelUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    iran_address: str | None = Field(default=None, min_length=1, max_length=255)
    iran_port: int | None = Field(default=None, ge=1, le=65535)
    foreign_node_id: int | None = None
    foreign_address: str | None = Field(default=None, max_length=255)
    foreign_port: int | None = Field(default=None, ge=1, le=65535)
    transport: TunnelTransport | None = None
    sni: str | None = Field(default=None, max_length=255)
    domain: str | None = Field(default=None, max_length=255)
    path: str | None = Field(default=None, max_length=255)
    spoof_source: str | None = Field(default=None, max_length=64)
    spoof_carrier: SpoofCarrier | None = None
    spoof_stealth: bool | None = None
    connection_count: int | None = Field(default=None, ge=1, le=256)
    forwards: list[TunnelForward] | None = Field(default=None, min_length=1)
    cdn_provider: CdnProvider | None = None
    cdn_host: str | None = Field(default=None, max_length=255)
    cdn_port: int | None = Field(default=None, ge=1, le=65535)
    cdn_ips: list[str] | None = Field(default=None, max_length=5)
    cdn_front: str | None = Field(default=None, max_length=255)


class TunnelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    iran_address: str
    iran_port: int
    foreign_node_id: int | None
    foreign_address: str | None
    foreign_port: int | None
    transport: TunnelTransport
    token: str
    sni: str | None
    domain: str | None
    path: str | None
    spoof_source: str | None = None
    spoof_carrier: str | None = None
    spoof_stealth: bool | None = None
    connection_count: int
    forwards: list[TunnelForward]
    cdn_provider: str | None = None
    cdn_host: str | None = None
    cdn_port: int | None = None
    cdn_ips: list[str] = []
    cdn_front: str | None = None
    status: TunnelStatus
    last_error: str | None
    last_checked_at: datetime | None
    created_at: datetime

    @field_validator("cdn_ips", mode="before")
    @classmethod
    def _none_is_empty(cls, v):
        return v or []


class TunnelList(BaseModel):
    total: int
    tunnels: list[TunnelResponse]


class TunnelTestResult(BaseModel):
    """`None` on a side means the check was skipped rather than failed —
    a udp tunnel's listener speaks KCP over UDP, which a TCP connect can
    neither reach nor disprove, so reporting it as unreachable would mark
    a perfectly healthy tunnel broken."""

    status: TunnelStatus
    iran_reachable: bool | None
    iran_latency_ms: float | None
    foreign_reachable: bool | None
    foreign_latency_ms: float | None
    # Only for a tunnel through a CDN: did a WebSocket upgrade sent to the
    # CDN hostname come back from the relay?
    cdn_reachable: bool | None = None
    cdn_latency_ms: float | None = None
    error: str | None


class TunnelConfig(BaseModel):
    """The literal config.json content for each side, plus one ready-to-run
    install command per side — each command carries its own config baked
    in (see app.tunnels.config.build_install_command), so pasting it on the
    right server installs and starts the tunnel with no interactive menu
    and no retyping the token/transport/forwards by hand."""

    iran_config: dict
    foreign_config: dict
    iran_install_command: str
    foreign_install_command: str


class TunnelRecommendRequest(BaseModel):
    iran_address: str = Field(min_length=1, max_length=255)
    iran_port: int = Field(default=8443, ge=1, le=65535)
    foreign_node_id: int | None = None
    foreign_address: str | None = Field(default=None, max_length=255)
    foreign_port: int | None = Field(default=None, ge=1, le=65535)


SpoofTestDirection = Literal["iran_to_foreign", "foreign_to_iran"]


class SpoofTestRequest(BaseModel):
    foreign_node_id: int | None = None
    foreign_address: str | None = Field(default=None, max_length=255)
    # Required only for the foreign_to_iran direction, where the Iran server is
    # the receiver the foreign side aims its forged packets at.
    iran_address: str | None = Field(default=None, max_length=255)
    port: int = Field(default=443, ge=1, le=65535)
    spoof_ip: str = Field(min_length=1, max_length=64)
    # Which egress to measure. iran_to_foreign checks whether the Iran
    # datacenter lets a forged source out (the usual precondition);
    # foreign_to_iran checks the same for the foreign datacenter, since the
    # tunnel forges a source in BOTH directions.
    direction: SpoofTestDirection = "iran_to_foreign"


class SpoofTestCommands(BaseModel):
    """Two ready-to-run commands for a spoof-ability check. Run
    `recv_command` on the `recv_on` server first, then `send_command` on the
    `send_on` server within its listen window; the receiver's output says
    which forged sources actually arrived. recv_on/send_on are "iran" or
    "foreign" so the UI can label which box each command belongs on."""

    recv_command: str
    send_command: str
    recv_on: str
    send_on: str


class DiscoverSourcesRequest(BaseModel):
    """Ask for the commands that sweep every curated domestic candidate at
    once, to learn which forged sources actually egress a datacenter. Like
    SpoofTestRequest but with no spoof_ip — the candidate list is built
    server-side from a vetted set, so the admin need not know any IP."""

    foreign_node_id: int | None = None
    foreign_address: str | None = Field(default=None, max_length=255)
    iran_address: str | None = Field(default=None, max_length=255)
    port: int = Field(default=443, ge=1, le=65535)
    direction: SpoofTestDirection = "iran_to_foreign"


class DiscoverCandidate(BaseModel):
    ip: str
    # The network the IP represents, or None when it arrived but is not one of
    # the curated candidates (e.g. a NAT rewrote the source).
    label: str | None = None


class DiscoverCommands(SpoofTestCommands):
    """The spoof-test commands, but sweeping the whole candidate set, plus the
    candidate list the UI shows so the admin sees what is being probed."""

    candidates: list[DiscoverCandidate]
    seconds: int


class ParseDiscoveryRequest(BaseModel):
    # The raw text the admin pastes back from the receiver command.
    output: str = Field(min_length=1, max_length=65536)


class DiscoveryResult(BaseModel):
    """Which forged sources made it through, labelled where known, plus a
    ready-to-paste comma list for the tunnel's spoof_source pool (idea #3:
    the tunnel rotates packets across every source in that pool)."""

    sources: list[DiscoverCandidate]
    spoof_source: str


class TunnelRecommendResult(BaseModel):
    """`link` is why the ranking came out the way it did, and applies to the
    whole list rather than to any one transport — the measurement behind it
    is the link's latency, not anything per-transport. It is a flag, not a
    sentence, so the UI can say it in the admin's own language."""

    iran_reachable: bool
    iran_latency_ms: float | None
    foreign_reachable: bool
    foreign_latency_ms: float | None
    link: Literal["fast", "slow"]
    ranked: list[TunnelTransport]


class CdnEdge(BaseModel):
    ip: str
    ms: int | None
    jitter: int | None
    ok: int
    tries: int


class CdnRanOn(BaseModel):
    ran_on: Literal["node", "panel"]
    ran_on_name: str


class CdnEdgeScan(CdnRanOn):
    ranges: int
    tested: int
    answered: int
    edges: list[CdnEdge]


class CdnFront(BaseModel):
    domain: str
    works: bool
    ms: int | None
    error: str | None


class CdnFrontScan(CdnRanOn):
    checked: int
    on_cdn: int
    fronts: list[CdnFront]


class CdnSpeed(CdnRanOn):
    ok: bool
    mbps: float | None
    ping_ms: int | None
    bytes: int
    seconds: float | None
    via: str
    error: str | None

