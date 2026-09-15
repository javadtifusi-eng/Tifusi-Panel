from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.host import HostProtocol

_PROTOCOLS = {p.value for p in HostProtocol}


def validate_protocols(protocols: list[str] | None) -> list[str] | None:
    if protocols is None:
        return None
    if not protocols:
        raise ValueError("pick at least one protocol")
    unknown = set(protocols) - _PROTOCOLS
    if unknown:
        raise ValueError(f"unknown protocol(s): {', '.join(sorted(unknown))}")
    return list(dict.fromkeys(protocols))


class ProtocolOption(BaseModel):
    protocol: str
    hosts: list[str]


class ResellerCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)
    # None = no limit of that kind.
    max_users: int | None = Field(default=None, ge=1)
    data_quota: int | None = Field(default=None, ge=1)
    protocols: list[str]

    _validate_protocols = field_validator("protocols")(validate_protocols)


class ResellerUpdate(BaseModel):
    """Only the fields sent change; an explicit null on max_users or
    data_quota removes that limit."""

    password: str | None = Field(default=None, min_length=8, max_length=128)
    max_users: int | None = Field(default=None, ge=1)
    data_quota: int | None = Field(default=None, ge=1)
    protocols: list[str] | None = None
    disabled: bool | None = None

    _validate_protocols = field_validator("protocols")(validate_protocols)


class ResellerItem(BaseModel):
    id: int
    username: str
    disabled: bool
    max_users: int | None
    data_quota: int | None
    protocols: list[str]
    users_count: int
    # Sum of the data limits of the reseller's current users.
    data_allocated: int
    used_traffic: int
    created_at: datetime


class ResellerList(BaseModel):
    resellers: list[ResellerItem]
    protocols: list[ProtocolOption]


class ResellerQuota(BaseModel):
    """What a signed-in reseller sees of its own limits (GET /api/admin/me)."""

    max_users: int | None
    users_count: int
    data_quota: int | None
    data_allocated: int
    used_traffic: int
    protocols: list[ProtocolOption]
