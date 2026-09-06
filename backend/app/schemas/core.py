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

    wireguard_public_key: str | None = None
    wireguard_private_key: str | None = None
    wireguard_port: int | None = Field(default=None, ge=1, le=65535)
    wireguard_subnet: str | None = None

    l2tp_psk: str | None = None

    ikev2_psk: str | None = None
    ikev2_remote_id: str | None = None

    @model_validator(mode="after")
    def _check_required_fields(self) -> "CoreCreate":
        if self.core_type == CoreType.xray:
            if not isinstance((self.config or {}).get("inbounds"), list):
                raise ValueError("config.inbounds must be a list — paste a real Xray config")
        elif self.core_type == CoreType.wireguard:
            _require(self.wireguard_public_key, "wireguard_public_key", "wireguard")
            _require(self.wireguard_private_key, "wireguard_private_key", "wireguard")
            _require(self.wireguard_port, "wireguard_port", "wireguard")
            _require(self.wireguard_subnet, "wireguard_subnet", "wireguard")
        elif self.core_type == CoreType.l2tp:
            _require(self.l2tp_psk, "l2tp_psk", "l2tp")
        elif self.core_type == CoreType.ikev2:
            _require(self.ikev2_psk, "ikev2_psk", "ikev2")
        return self


class CoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None
    config: dict[str, Any] | None = None

    wireguard_public_key: str | None = None
    wireguard_private_key: str | None = None
    wireguard_port: int | None = Field(default=None, ge=1, le=65535)
    wireguard_subnet: str | None = None

    l2tp_psk: str | None = None

    ikev2_psk: str | None = None
    ikev2_remote_id: str | None = None


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

    wireguard_public_key: str | None
    wireguard_private_key: str | None
    wireguard_port: int | None
    wireguard_subnet: str | None

    l2tp_psk: str | None

    ikev2_psk: str | None
    ikev2_remote_id: str | None


class CoreList(BaseModel):
    total: int
    cores: list[CoreResponse]
