from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.core import CoreType


def _require(value, name: str, core_type: str) -> None:
    if not value:
        raise ValueError(f"{core_type} core requires {name}")


class CoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=500)
    core_type: CoreType
    config: dict[str, Any] | None = None

    l2tp_psk: str | None = None

    ikev2_psk: str | None = None
    ikev2_remote_id: str | None = None
    ikev2_certificate: str | None = None
    ikev2_certificate_key: str | None = None
    ikev2_egress_vless: str | None = None
    ikev2_auth_mode: str = "eap"

    hysteria2_port: int | None = Field(default=None, ge=1, le=65535)
    hysteria2_obfs: str | None = Field(default=None, max_length=64)
    hysteria2_rate_mbps: int | None = Field(default=None, ge=1, le=10000)

    @model_validator(mode="after")
    def _check_required_fields(self) -> "CoreCreate":
        if self.core_type == CoreType.xray:
            if not isinstance((self.config or {}).get("inbounds"), list):
                raise ValueError("config.inbounds must be a list — paste a real Xray config")
        elif self.core_type == CoreType.l2tp:
            _require(self.l2tp_psk, "l2tp_psk", "l2tp")
        elif self.core_type == CoreType.ikev2:
            if self.ikev2_auth_mode not in ("eap", "psk"):
                raise ValueError("ikev2_auth_mode must be 'eap' or 'psk'")
            _require(self.ikev2_remote_id, "ikev2_remote_id", "ikev2")
            if self.ikev2_auth_mode == "psk":
                # Shared-secret mode: no certificate involved at all — see
                # node_agent/ipsec.py for why this mode exists.
                _require(self.ikev2_psk, "ikev2_psk", "ikev2 (psk mode)")
            elif bool(self.ikev2_certificate) != bool(self.ikev2_certificate_key):
                # eap mode: no PSK requirement — the node authenticates
                # itself with a certificate (self-signed off ikev2_remote_id,
                # or ikev2_certificate/_key below if set), not a shared secret.
                raise ValueError("ikev2_certificate and ikev2_certificate_key must be set together")
        elif self.core_type == CoreType.hysteria2:
            _require(self.hysteria2_port, "hysteria2_port", "hysteria2")
            # Without obfuscation the first packet is a plain QUIC handshake,
            # which Iranian networks drop wholesale — a server that works from
            # anywhere else is unreachable from Iran for that reason alone, so
            # this is required rather than optional.
            _require(self.hysteria2_obfs, "hysteria2_obfs", "hysteria2")
            if self.hysteria2_port == 443:
                # Measured from Iran on mobile and fixed lines alike: UDP 443
                # answered nothing at all. Refused rather than warned here,
                # because a Core is what a node is told to run.
                raise ValueError("UDP 443 is filtered from Iran — pick another port")
        return self


class CoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None
    config: dict[str, Any] | None = None
    hysteria2_port: int | None = Field(default=None, ge=1, le=65535)
    hysteria2_obfs: str | None = Field(default=None, max_length=64)
    hysteria2_rate_mbps: int | None = Field(default=None, ge=1, le=10000)


    l2tp_psk: str | None = None

    ikev2_psk: str | None = None
    ikev2_remote_id: str | None = None
    ikev2_certificate: str | None = None
    ikev2_certificate_key: str | None = None
    ikev2_egress_vless: str | None = None
    ikev2_auth_mode: str | None = None


class InboundResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tag: str
    protocol: str
    network: str
    security: str
    port: int | None
    encryption: str | None
    flow: str | None
    header_type: str | None
    path: str | None
    host_header: str | None
    sni: str | None
    alpn: str | None
    fingerprint: str | None
    reality_public_key: str | None
    reality_short_id: str | None
    host_count: int = 0
    group_ids: list[int] = Field(default_factory=list)


class CoreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str | None
    core_type: CoreType
    config: dict[str, Any] | None
    created_at: datetime
    inbounds: list[InboundResponse]
    node_count: int
    host_count: int = 0
    warnings: list[str] = Field(default_factory=list)

    l2tp_psk: str | None

    ikev2_psk: str | None
    ikev2_remote_id: str | None
    hysteria2_port: int | None
    hysteria2_obfs: str | None
    hysteria2_rate_mbps: int | None
    ikev2_certificate: str | None
    ikev2_certificate_key: str | None
    ikev2_egress_vless: str | None
    ikev2_auth_mode: str


class CoreList(BaseModel):
    total: int
    cores: list[CoreResponse]
