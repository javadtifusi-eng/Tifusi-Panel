from pydantic import BaseModel, ConfigDict


class PanelSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    public_url: str | None


class PanelSettingsUpdate(BaseModel):
    public_url: str | None = None
