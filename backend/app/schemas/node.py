from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.node import NodeStatus


class NodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    port: int = Field(default=62050, ge=1, le=65535)


class NodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str
    port: int
    api_key: str
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
