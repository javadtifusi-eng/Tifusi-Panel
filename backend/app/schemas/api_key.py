from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ApiKeyCreateResponse(BaseModel):
    id: int
    name: str
    # Only ever present in this one response — creation time. Never
    # returned again afterwards, same as any other API-key issuer.
    key: str
    key_prefix: str
    created_at: datetime


class ApiKeyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None


class ApiKeyList(BaseModel):
    total: int
    keys: list[ApiKeyListItem]
