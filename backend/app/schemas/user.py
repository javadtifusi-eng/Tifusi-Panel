import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserStatus

USERNAME_PATTERN = r"^[a-zA-Z0-9_-]+$"


class ProxyUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    status: UserStatus = UserStatus.active
    data_limit: int | None = Field(default=None, ge=0)
    expire: datetime | None = None
    on_hold_expire_days: int | None = Field(default=None, ge=0)
    hwid_limit: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)
    group_ids: list[int] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _validate_creatable_status(cls, status: UserStatus) -> UserStatus:
        if status not in (UserStatus.active, UserStatus.on_hold):
            raise ValueError("a new user can only be created active or on_hold")
        return status


class ProxyUserUpdate(BaseModel):
    status: UserStatus | None = None
    data_limit: int | None = Field(default=None, ge=0)
    expire: datetime | None = None
    on_hold_expire_days: int | None = Field(default=None, ge=0)
    hwid_limit: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)
    group_ids: list[int] | None = None


class ProxyUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    status: UserStatus
    secret: str
    data_limit: int | None
    used_traffic: int
    expire: datetime | None
    on_hold_expire_days: int | None
    hwid_limit: int | None
    note: str | None
    created_at: datetime
    group_ids: list[int]
    admin_id: int | None


class ProxyUserList(BaseModel):
    total: int
    users: list[ProxyUserResponse]


class BulkCreateRequest(BaseModel):
    usernames: list[str] = Field(min_length=1, max_length=500)
    data_limit: int | None = Field(default=None, ge=0)
    expire: datetime | None = None
    hwid_limit: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)
    group_ids: list[int] = Field(default_factory=list)

    @field_validator("usernames")
    @classmethod
    def _validate_usernames(cls, usernames: list[str]) -> list[str]:
        pattern = re.compile(USERNAME_PATTERN)
        for name in usernames:
            if not (3 <= len(name) <= 64) or not pattern.match(name):
                raise ValueError(f"invalid username: {name!r}")
        return usernames


class BulkCreateResult(BaseModel):
    created: list[ProxyUserResponse]
    skipped: list[str]


class BulkUpdateRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=1000)
    status: UserStatus | None = None
    data_limit: int | None = Field(default=None, ge=0)
    expire: datetime | None = None
    hwid_limit: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)
    add_group_ids: list[int] = Field(default_factory=list)
    remove_group_ids: list[int] = Field(default_factory=list)


class BulkUpdateResult(BaseModel):
    updated: int


class BulkDeleteRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=1000)


class BulkDeleteResult(BaseModel):
    deleted: int
