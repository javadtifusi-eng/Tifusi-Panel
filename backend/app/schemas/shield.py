from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.shield import ShieldMode

MemberState = Literal["active", "standby", "burnt"]


class ShieldGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    mode: ShieldMode
    dns_record: str | None = Field(default=None, max_length=255)
    cloudflare_token: str | None = Field(default=None, max_length=255)
    fail_threshold: int = Field(default=3, ge=1, le=20)
    # In order of preference; the first one is taken to be the relay
    # clients use right now.
    tunnel_ids: list[int] = Field(min_length=1, max_length=20)


class ShieldGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    enabled: bool | None = None
    mode: ShieldMode | None = None
    dns_record: str | None = Field(default=None, max_length=255)
    # Omitted keeps the stored token; an empty string clears it.
    cloudflare_token: str | None = Field(default=None, max_length=255)
    fail_threshold: int | None = Field(default=None, ge=1, le=20)
    tunnel_ids: list[int] | None = Field(default=None, min_length=1, max_length=20)


class ShieldSwitchRequest(BaseModel):
    tunnel_id: int


class ShieldMemberResponse(BaseModel):
    tunnel_id: int
    name: str
    iran_address: str
    iran_port: int
    position: int
    state: MemberState
    last_ok: bool | None
    last_latency_ms: int | None
    fail_streak: int
    last_checked_at: datetime | None
    burnt_at: datetime | None


class ShieldEventResponse(BaseModel):
    id: int
    kind: str
    data: dict[str, Any]
    created_at: datetime


class ShieldGroupResponse(BaseModel):
    id: int
    name: str
    enabled: bool
    mode: ShieldMode
    dns_record: str | None
    has_cloudflare_token: bool
    fail_threshold: int
    active_tunnel_id: int | None
    stranded: bool
    last_error: str | None
    last_checked_at: datetime | None
    members: list[ShieldMemberResponse]
    events: list[ShieldEventResponse]


class ShieldGroupList(BaseModel):
    check_interval_seconds: int
    groups: list[ShieldGroupResponse]
