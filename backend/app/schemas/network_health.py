from datetime import datetime
from typing import Literal

from pydantic import BaseModel

HealthState = Literal["good", "warn", "bad", "unknown"]


class OperatorHealth(BaseModel):
    key: str
    name_fa: str
    name_en: str
    attempts: int
    successes: int
    rate: float | None
    users: int
    sub_attempts: int
    sub_successes: int
    recent_rate: float | None
    previous_rate: float | None
    state: HealthState
    last_at: datetime | None
    # Success rate per time bucket (None where there were too few attempts),
    # for the small trend line on each operator's card.
    trend: list[float | None] = []


class SeriesLine(BaseModel):
    key: str
    rates: list[float | None]
    attempts: list[int]


class MatrixCell(BaseModel):
    operator: str
    attempts: int
    successes: int


class ProtocolRow(BaseModel):
    protocol: str
    attempts: int
    cells: list[MatrixCell]


class HealthAlert(BaseModel):
    kind: Literal["drop", "subscription"]
    operator: str
    recent_rate: float
    previous_rate: float | None
    attempts: int


class NetworkHealthReport(BaseModel):
    hours: int
    generated_at: datetime
    bucket_minutes: int
    buckets: list[datetime]
    attempts: int
    successes: int
    rate: float | None
    users: int
    operators: list[OperatorHealth]
    series: list[SeriesLine]
    protocols: list[ProtocolRow]
    alerts: list[HealthAlert]
