from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.node import NodeStatus


def _clean_egress_vless(value: str | None) -> str | None:
    """Blank textarea submits as "" — treat that the same as never having
    set it, rather than storing an empty string the node agent would then
    fail to parse as a vless:// link."""
    value = (value or "").strip()
    if not value:
        return None
    if not value.startswith("vless://"):
        raise ValueError("l2tp_egress_vless must be a vless:// link")
    return value


class NodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    port: int = Field(default=62050, ge=1, le=65535)
    core_id: int | None = None
    ipsec_core_id: int | None = None
    l2tp_egress_vless: str | None = Field(default=None, max_length=2048)

    _clean_l2tp_egress_vless = field_validator("l2tp_egress_vless")(_clean_egress_vless)


class NodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    core_id: int | None = None
    ipsec_core_id: int | None = None
    l2tp_egress_vless: str | None = Field(default=None, max_length=2048)

    _clean_l2tp_egress_vless = field_validator("l2tp_egress_vless")(_clean_egress_vless)


class NodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str
    port: int
    api_key: str
    core_id: int | None
    ipsec_core_id: int | None
    l2tp_egress_vless: str | None
    status: NodeStatus
    xray_version: str | None
    last_error: str | None
    last_synced_at: datetime | None
    created_at: datetime


class NodeList(BaseModel):
    total: int
    nodes: list[NodeResponse]


class NodeSyncResult(BaseModel):
    status: NodeStatus
    xray_version: str | None
    error: str | None
    inbound_count: int
