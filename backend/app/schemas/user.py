from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import UserStatus


class ProxyUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    data_limit: int | None = Field(default=None, ge=0)
    expire: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class ProxyUserUpdate(BaseModel):
    status: UserStatus | None = None
    data_limit: int | None = Field(default=None, ge=0)
    expire: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class ProxyUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    status: UserStatus
    secret: str
    data_limit: int | None
    used_traffic: int
    expire: datetime | None
    note: str | None
    created_at: datetime


class ProxyUserList(BaseModel):
    total: int
    users: list[ProxyUserResponse]
