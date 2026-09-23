from pydantic import BaseModel, ConfigDict


class PanelSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    public_url: str | None
    subscription_url: str | None
    telegram_bot_token: str | None
    telegram_chat_id: str | None
    webhook_url: str | None
    webhook_secret: str | None
    discord_webhook_url: str | None
    backup_domains: list[str] | None = None
    backup_auto_failover: bool = False


class PanelSettingsUpdate(BaseModel):
    public_url: str | None = None
    # A second domain pointing at the same server, handed to customers instead of
    # public_url so the panel's own address is not in every subscription link.
    # Empty falls back to public_url.
    subscription_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    webhook_url: str | None = None
    webhook_secret: str | None = None
    discord_webhook_url: str | None = None
    backup_auto_failover: bool | None = None


class BackupDomainState(BaseModel):
    domain: str
    has_cert: bool
    live: bool = False


class BackupDomainsResponse(BaseModel):
    live: str | None
    live_ok: bool | None
    live_reachable: int
    live_total: int
    backups: list[BackupDomainState]
    auto_failover: bool


class BackupDomainAdd(BaseModel):
    domain: str
