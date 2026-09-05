from pydantic import BaseModel, ConfigDict, Field


class AdminProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    is_owner: bool


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)
