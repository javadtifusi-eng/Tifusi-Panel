from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=500)
    host_ids: list[int] = Field(default_factory=list)
    user_ids: list[int] = Field(default_factory=list)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = None
    host_ids: list[int] | None = None
    user_ids: list[int] | None = None


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str | None
    created_at: datetime
    host_ids: list[int]
    user_ids: list[int]


class GroupList(BaseModel):
    total: int
    groups: list[GroupResponse]
