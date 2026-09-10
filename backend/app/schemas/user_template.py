from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    data_limit: int | None = Field(default=None, ge=0)
    expire_days: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)
    group_ids: list[int] = Field(default_factory=list)


class UserTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    data_limit: int | None = Field(default=None, ge=0)
    expire_days: int | None = Field(default=None, ge=0)
    note: str | None = None
    group_ids: list[int] | None = None


class UserTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    data_limit: int | None
    expire_days: int | None
    note: str | None
    created_at: datetime
    group_ids: list[int]


class UserTemplateList(BaseModel):
    total: int
    templates: list[UserTemplateResponse]
