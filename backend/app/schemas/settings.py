from pydantic import BaseModel, ConfigDict


class PanelSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    public_url: str | None
    telegram_bot_token: str | None
    telegram_chat_id: str | None
    ai_api_key: str | None


class PanelSettingsUpdate(BaseModel):
    public_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    ai_api_key: str | None = None
