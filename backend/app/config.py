from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Tifusi Panel"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    setup_key_ttl_minutes: int = 30
    database_url: str = "sqlite+aiosqlite:///./data/tifusi.db"
    cors_origins: list[str] = ["*"]

    model_config = SettingsConfigDict(env_file=".env", env_prefix="TIFUSI_")


settings = Settings()
