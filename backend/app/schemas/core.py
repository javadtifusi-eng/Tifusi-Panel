from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.host import HostNetwork, HostProtocol, HostSecurity


class CoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=500)

    # No default on purpose — the admin must always choose explicitly.
    protocol: HostProtocol
    network: HostNetwork | None = None
    security: HostSecurity | None = None
    default_port: int | None = Field(default=None, ge=1, le=65535)

    sni: str | None = None
    fingerprint: str | None = None
    alpn: str | None = None
    path: str | None = None
    host_header: str | None = None

    reality_public_key: str | None = None
    reality_private_key: str | None = None
    reality_short_id: str | None = None

    wireguard_public_key: str | None = None
    wireguard_private_key: str | None = None
    wireguard_subnet: str | None = None


class CoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None

    protocol: HostProtocol | None = None
    network: HostNetwork | None = None
    security: HostSecurity | None = None
    default_port: int | None = Field(default=None, ge=1, le=65535)

    sni: str | None = None
    fingerprint: str | None = None
    alpn: str | None = None
    path: str | None = None
    host_header: str | None = None

    reality_public_key: str | None = None
    reality_private_key: str | None = None
    reality_short_id: str | None = None

    wireguard_public_key: str | None = None
    wireguard_private_key: str | None = None
    wireguard_subnet: str | None = None


class CoreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str | None
    protocol: HostProtocol
    network: HostNetwork | None
    security: HostSecurity | None
    default_port: int | None
    sni: str | None
    fingerprint: str | None
    alpn: str | None
    path: str | None
    host_header: str | None
    reality_public_key: str | None
    reality_private_key: str | None
    reality_short_id: str | None
    wireguard_public_key: str | None
    wireguard_private_key: str | None
    wireguard_subnet: str | None
    created_at: datetime
    host_count: int
    node_count: int


class CoreList(BaseModel):
    total: int
    cores: list[CoreResponse]
