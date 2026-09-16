from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.tunnel import TunnelStatus, TunnelTransport

ForwardNet = Literal["tcp", "udp"]


class TunnelForward(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    listen_port: int = Field(ge=1, le=65535)
    net: ForwardNet
    target_port: int = Field(ge=1, le=65535)


class TunnelCreate(BaseModel):
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
    connection_count: int = Field(default=8, ge=1, le=256)
    forwards: list[TunnelForward] = []


class TunnelUpdate(BaseModel):
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
    connection_count: int | None = Field(default=None, ge=1, le=256)
    forwards: list[TunnelForward] | None = None


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
    connection_count: int
    forwards: list[TunnelForward]
    status: TunnelStatus
    last_error: str | None
    last_checked_at: datetime | None
    created_at: datetime


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


class SpoofTestRequest(BaseModel):
    foreign_node_id: int | None = None
    foreign_address: str | None = Field(default=None, max_length=255)
    port: int = Field(default=443, ge=1, le=65535)
    spoof_ip: str = Field(min_length=1, max_length=64)


class SpoofTestCommands(BaseModel):
    """The two ready-to-run commands for a spoof-ability check: paste
    `foreign_recv_command` on the foreign server first, then
    `iran_send_command` on the Iran server within its listen window. The
    foreign server's output says which forged sources actually arrived."""

    foreign_recv_command: str
    iran_send_command: str


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
