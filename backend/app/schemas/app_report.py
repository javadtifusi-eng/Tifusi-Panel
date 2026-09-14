from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator

# event/result/network are kept as short free-form strings rather than
# Literal enums on purpose: the app ships on its own release cycle, and an
# older panel rejecting a whole batch with 422 because a newer app added
# one new event name would throw away exactly the diagnostics this exists
# to collect. Lengths are still capped so nothing unbounded gets stored.


class AppReportItem(BaseModel):
    at: int = Field(ge=0, le=4_102_444_800_000, description="Epoch milliseconds, device clock")
    event: str = Field(min_length=1, max_length=32)
    result: str = Field(min_length=1, max_length=32)
    detail: str | None = Field(default=None, max_length=500)
    protocol: str | None = Field(default=None, max_length=32)
    duration_ms: int | None = Field(default=None, ge=0, le=10_000_000_000)
    network: str | None = Field(default=None, max_length=32)
    carrier: str | None = Field(default=None, max_length=100)
    sim_carrier: str | None = Field(default=None, max_length=100)


class AppReportPayload(BaseModel):
    subscription: str = Field(min_length=1, max_length=512)
    app_version: str | None = Field(default=None, max_length=32)
    android_sdk: int | None = Field(default=None, ge=0, le=1000)
    device: str | None = Field(default=None, max_length=100)
    reports: list[AppReportItem] = Field(default_factory=list, max_length=50)


class AppReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    received_at: datetime
    reported_at: datetime
    client_ip: str
    app_version: str | None
    android_sdk: int | None
    device: str | None
    event: str
    result: str
    detail: str | None
    protocol: str | None
    duration_ms: int | None
    network: str | None
    carrier: str | None
    sim_carrier: str | None

    @field_validator("received_at", "reported_at")
    @classmethod
    def _assume_utc(cls, value: datetime) -> datetime:
        # SQLite (via aiosqlite) doesn't persist tzinfo, so these come back
        # naive even though they were written as UTC. Without an explicit
        # offset in the JSON, the dashboard's `new Date(...)` would read
        # them as the admin's local time and shift every report by hours.
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class RecentAppReportResponse(AppReportResponse):
    """One row of the dashboard's recent-activity feed: a report plus the
    user it belongs to, so the overview doesn't need a lookup per row."""

    user_id: int
    username: str
