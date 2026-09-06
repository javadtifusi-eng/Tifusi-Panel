from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.host import HostProtocol, HostSecurity


class HostCreate(BaseModel):
    remark: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    protocol: HostProtocol
    group_ids: list[int] = Field(default_factory=list)

    # vless/vmess/trojan/shadowsocks
    inbound_id: int | None = None
    port_override: int | None = Field(default=None, ge=1, le=65535)
    sni_override: str | None = None
    alpn_override: str | None = None
    fingerprint_override: str | None = None
    path_override: str | None = None
    host_header_override: str | None = None
    security_override: HostSecurity | None = None
    allowinsecure: bool = False

    # wireguard
    wireguard_public_key: str | None = None
    wireguard_private_key: str | None = None
    wireguard_subnet: str | None = None
    wireguard_port: int | None = Field(default=None, ge=1, le=65535)

    # hysteria2
    hysteria2_sni: str | None = None
    hysteria2_port: int | None = Field(default=None, ge=1, le=65535)


class HostUpdate(BaseModel):
    remark: str | None = Field(default=None, min_length=1, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    group_ids: list[int] | None = None

    inbound_id: int | None = None
    port_override: int | None = Field(default=None, ge=1, le=65535)
    sni_override: str | None = None
    alpn_override: str | None = None
    fingerprint_override: str | None = None
    path_override: str | None = None
    host_header_override: str | None = None
    security_override: HostSecurity | None = None
    allowinsecure: bool | None = None

    wireguard_public_key: str | None = None
    wireguard_private_key: str | None = None
    wireguard_subnet: str | None = None
    wireguard_port: int | None = Field(default=None, ge=1, le=65535)

    hysteria2_sni: str | None = None
    hysteria2_port: int | None = Field(default=None, ge=1, le=65535)


class HostResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    remark: str
    address: str
    protocol: HostProtocol
    created_at: datetime
    group_ids: list[int]

    inbound_id: int | None
    port_override: int | None
    sni_override: str | None
    alpn_override: str | None
    fingerprint_override: str | None
    path_override: str | None
    host_header_override: str | None
    security_override: HostSecurity | None
    allowinsecure: bool

    wireguard_public_key: str | None
    wireguard_private_key: str | None
    wireguard_subnet: str | None
    wireguard_port: int | None

    hysteria2_sni: str | None
    hysteria2_port: int | None

    network: str | None
    effective_security: str | None
    effective_port: int | None
    effective_sni: str | None
    effective_alpn: str | None
    effective_fingerprint: str | None
    effective_path: str | None
    effective_host_header: str | None


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
