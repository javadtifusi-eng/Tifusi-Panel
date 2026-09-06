from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=500)
    config: dict[str, Any]

    @field_validator("config")
    @classmethod
    def _must_have_inbounds(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value.get("inbounds"), list):
            raise ValueError("config.inbounds must be a list — paste a real Xray config")
        return value


class CoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None
    config: dict[str, Any] | None = None

    @field_validator("config")
    @classmethod
    def _must_have_inbounds(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and not isinstance(value.get("inbounds"), list):
            raise ValueError("config.inbounds must be a list — paste a real Xray config")
        return value


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
    config: dict[str, Any]
    created_at: datetime
    inbounds: list[InboundResponse]
    node_count: int
    warnings: list[str] = Field(default_factory=list)


class CoreList(BaseModel):
    total: int
    cores: list[CoreResponse]
