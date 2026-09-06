from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.host import HostNetwork, HostProtocol, HostSecurity


class HostCreate(BaseModel):
    remark: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    core_id: int
    port: int | None = Field(default=None, ge=1, le=65535)
    sni_override: str | None = None
    alpn_override: str | None = None
    group_ids: list[int] = Field(default_factory=list)


class HostUpdate(BaseModel):
    remark: str | None = Field(default=None, min_length=1, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    core_id: int | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    sni_override: str | None = None
    alpn_override: str | None = None
    group_ids: list[int] | None = None


class HostResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    remark: str
    address: str
    port: int | None
    sni_override: str | None
    alpn_override: str | None
    created_at: datetime
    group_ids: list[int]
    core_id: int

    # Read through the Core (via Host's passthrough properties) so the
    # frontend can show these without a second lookup.
    protocol: HostProtocol
    network: HostNetwork | None
    security: HostSecurity | None
    effective_port: int | None
    effective_sni: str | None
    effective_alpn: str | None


class HostList(BaseModel):
    total: int
    hosts: list[HostResponse]


class RealityKeypairResponse(BaseModel):
    private_key: str
    public_key: str
    short_id: str


class WireGuardKeypairResponse(BaseModel):
    private_key: str
    public_key: str
