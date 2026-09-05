from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Tifusi Panel"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    setup_key_ttl_minutes: int = 30
    database_url: str = "sqlite+aiosqlite:///./data/tifusi.db"
    cors_origins: list[str] = ["*"]
    # Set this (e.g. https://panel.example.com:8000) when the panel sits
    # behind a proxy/container network — otherwise subscription URLs are
    # built from the request's own Host header, which is wrong whenever
    # that header is an internal hostname the client can't reach.
    public_url: str | None = None

    # How often the panel pulls traffic deltas from every connected node and
    # checks expire/data_limit. Real usage tracking depends on this loop —
    # see app/traffic/sync.py.
    traffic_sync_interval_seconds: int = 30

    # Only read by run.py, not by uvicorn's own CLI — if you start the panel
    # with `uvicorn app.main:app` directly, these are ignored and you pass
    # --host/--port/--ssl-certfile/--ssl-keyfile yourself instead. Setting
    # both ssl_certfile and ssl_keyfile makes run.py terminate TLS directly
    # in uvicorn, for a deployment with no reverse proxy in front of it.
    uvicorn_host: str = "0.0.0.0"
    uvicorn_port: int = 8000
    ssl_certfile: str | None = None
    ssl_keyfile: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_prefix="TIFUSI_")


settings = Settings()
