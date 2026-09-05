from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.host import HostNetwork, HostProtocol, HostSecurity


class HostCreate(BaseModel):
    remark: str = Field(min_length=1, max_length=100)
    protocol: HostProtocol
    address: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    network: HostNetwork | None = None
    security: HostSecurity | None = None
    sni: str | None = None
    reality_public_key: str | None = None
    reality_private_key: str | None = None
    reality_short_id: str | None = None
    group_ids: list[int] = Field(default_factory=list)


class HostUpdate(BaseModel):
    remark: str | None = Field(default=None, min_length=1, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    network: HostNetwork | None = None
    security: HostSecurity | None = None
    sni: str | None = None
    reality_public_key: str | None = None
    reality_private_key: str | None = None
    reality_short_id: str | None = None
    group_ids: list[int] | None = None


class HostResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    remark: str
    protocol: HostProtocol
    address: str
    port: int
    network: HostNetwork | None
    security: HostSecurity | None
    sni: str | None
    reality_public_key: str | None
    reality_private_key: str | None
    reality_short_id: str | None
    created_at: datetime
    group_ids: list[int]


class HostList(BaseModel):
    total: int
    hosts: list[HostResponse]


class RealityKeypairResponse(BaseModel):
    private_key: str
    public_key: str
    short_id: str
