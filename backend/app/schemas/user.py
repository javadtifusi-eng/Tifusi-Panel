import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserStatus
from app.schemas.reseller import validate_protocols

USERNAME_PATTERN = r"^[a-zA-Z0-9_-]+$"
# The node writes this inside double quotes into swanctl.conf (escaping only
# `"`) and chap-secrets (dropping `"` outright), so quotes, backslashes and
# whitespace would leave IKEv2 or L2TP checking a different password than the
# one the user was shown.
IPSEC_PASSWORD_PATTERN = r"^[A-Za-z0-9@#$%&*._+=!-]{6,32}$"


class ProxyUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    status: UserStatus = UserStatus.active
    data_limit: int | None = Field(default=None, ge=0)
    data_limit_reset_days: int | None = Field(default=None, ge=1)
    expire: datetime | None = None
    on_hold_expire_days: int | None = Field(default=None, ge=0)
    hwid_limit: int | None = Field(default=None, ge=0)
    speed_limit_mbps: int | None = Field(default=None, ge=1)
    config_lock: bool | None = None
    note: str | None = Field(default=None, max_length=500)
    group_ids: list[int] = Field(default_factory=list)
    # None = every protocol; a reseller's user gets the reseller's own when left out.
    protocols: list[str] | None = None
    # None = log in to IKEv2/L2TP with `secret`, as before.
    ipsec_password: str | None = Field(default=None, pattern=IPSEC_PASSWORD_PATTERN)

    _validate_protocols = field_validator("protocols")(validate_protocols)

    @field_validator("status")
    @classmethod
    def _validate_creatable_status(cls, status: UserStatus) -> UserStatus:
        if status not in (UserStatus.active, UserStatus.on_hold):
            raise ValueError("a new user can only be created active or on_hold")
        return status


class ProxyUserUpdate(BaseModel):
    status: UserStatus | None = None
    data_limit: int | None = Field(default=None, ge=0)
    data_limit_reset_days: int | None = Field(default=None, ge=1)
    expire: datetime | None = None
    on_hold_expire_days: int | None = Field(default=None, ge=0)
    hwid_limit: int | None = Field(default=None, ge=0)
    speed_limit_mbps: int | None = Field(default=None, ge=1)
    config_lock: bool | None = None
    note: str | None = Field(default=None, max_length=500)
    group_ids: list[int] | None = None
    protocols: list[str] | None = None
    # An explicit null goes back to logging in with `secret`.
    ipsec_password: str | None = Field(default=None, pattern=IPSEC_PASSWORD_PATTERN)

    _validate_protocols = field_validator("protocols")(validate_protocols)


class ProxyUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    status: UserStatus
    secret: str
    ipsec_password: str | None
    data_limit: int | None
    data_limit_reset_days: int | None
    data_limit_reset_at: datetime | None
    used_traffic: int
    expire: datetime | None
    on_hold_expire_days: int | None
    hwid_limit: int | None
    note: str | None
    created_at: datetime
    group_ids: list[int]
    protocols: list[str] | None
    admin_id: int | None
    speed_limit_mbps: int | None
    config_lock: bool | None = None
    last_seen: datetime | None


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
    protocols: list[str] | None = None

    _validate_protocols = field_validator("protocols")(validate_protocols)

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
