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

    @model_validator(mode="after")
    def _check_required_fields(self) -> "CoreCreate":
        if self.core_type == CoreType.xray:
            if not isinstance((self.config or {}).get("inbounds"), list):
                raise ValueError("config.inbounds must be a list — paste a real Xray config")
        elif self.core_type == CoreType.l2tp:
            _require(self.l2tp_psk, "l2tp_psk", "l2tp")
        elif self.core_type == CoreType.ikev2:
            # No PSK requirement any more: the node authenticates itself to
            # clients with a certificate (self-signed off ikev2_remote_id,
            # or ikev2_certificate/_key below if set), not a shared secret —
            # see node_agent/ipsec.py. remote_id is what the cert's CN/SAN
            # is built from, so it's the one field that's actually required.
            _require(self.ikev2_remote_id, "ikev2_remote_id", "ikev2")
            if bool(self.ikev2_certificate) != bool(self.ikev2_certificate_key):
                raise ValueError("ikev2_certificate and ikev2_certificate_key must be set together")
        return self


class CoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None
    config: dict[str, Any] | None = None

    l2tp_psk: str | None = None

    ikev2_psk: str | None = None
    ikev2_remote_id: str | None = None
    ikev2_certificate: str | None = None
    ikev2_certificate_key: str | None = None


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
    ikev2_certificate: str | None
    ikev2_certificate_key: str | None


class CoreList(BaseModel):
    total: int
    cores: list[CoreResponse]
