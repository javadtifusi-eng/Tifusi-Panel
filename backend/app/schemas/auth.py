from pydantic import BaseModel, Field


class SetupStatus(BaseModel):
    has_admin: bool


class CreateAdminRequest(BaseModel):
    key: str
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
