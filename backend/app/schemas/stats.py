from pydantic import BaseModel


class TrafficHistoryPoint(BaseModel):
    date: str
    total_bytes: int


class TrafficHistory(BaseModel):
    points: list[TrafficHistoryPoint]
