from pydantic import BaseModel, ConfigDict


class PanelSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    public_url: str | None
    telegram_bot_token: str | None
    telegram_chat_id: str | None
    webhook_url: str | None
    webhook_secret: str | None
    discord_webhook_url: str | None


class PanelSettingsUpdate(BaseModel):
    public_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    webhook_url: str | None = None
    webhook_secret: str | None = None
    discord_webhook_url: str | None = None
