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
    # The authenticator app's six-digit code, or one of the recovery codes. Only needed when the account
    # has two-factor login on; the first attempt without it gets a 401 with detail "otp_required".
    otp: str | None = Field(default=None, max_length=32)


class TwoFactorStatus(BaseModel):
    enabled: bool
    recovery_codes_left: int


class TwoFactorSetup(BaseModel):
    secret: str
    otpauth_uri: str


class TwoFactorCode(BaseModel):
    code: str = Field(min_length=6, max_length=32)


class TwoFactorDisable(BaseModel):
    password: str
    code: str = Field(min_length=6, max_length=32)


class TwoFactorRecoveryCodes(BaseModel):
    recovery_codes: list[str]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
