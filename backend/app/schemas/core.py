from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=500)


class CoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None


class CoreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str | None
    created_at: datetime
    host_count: int
    node_count: int


class CoreList(BaseModel):
    total: int
    cores: list[CoreResponse]
