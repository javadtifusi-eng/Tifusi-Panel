from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AdminProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    is_owner: bool


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class AdminCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)


class AdminListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_owner: bool
    created_at: datetime


class AdminList(BaseModel):
    total: int
    admins: list[AdminListItem]
