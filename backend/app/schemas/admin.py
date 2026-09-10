from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.permissions import PERMISSION_SCOPES


def _validate_scopes(scopes: list[str] | None) -> list[str] | None:
    if scopes is None:
        return None
    invalid = set(scopes) - set(PERMISSION_SCOPES)
    if invalid:
        raise ValueError(f"unknown permission scope(s): {', '.join(sorted(invalid))}")
    return scopes


class AdminProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    is_owner: bool
    permissions: list[str] | None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class AdminCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)
    # None = full access; an explicit (possibly empty) list restricts this
    # admin to exactly those scopes.
    permissions: list[str] | None = None

    _validate_permissions = field_validator("permissions")(_validate_scopes)


class AdminPermissionsUpdate(BaseModel):
    permissions: list[str] | None = None

    _validate_permissions = field_validator("permissions")(_validate_scopes)


class AdminListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_owner: bool
    permissions: list[str] | None
    created_at: datetime


class AdminList(BaseModel):
    total: int
    admins: list[AdminListItem]
