from pydantic import BaseModel, Field


class RealityScanRequest(BaseModel):
    # None = scan the full built-in candidate list.
    targets: list[str] | None = None
    sample_size: int | None = Field(default=None, ge=1, le=500)


class RealityScanResult(BaseModel):
    host: str
    reachable: bool
    tls_version: str | None
    alpn: str | None
    latency_ms: float | None
    error: str | None
    recommended: bool = False


class RealityScanResponse(BaseModel):
    scanned: int
    usable: int
    results: list[RealityScanResult]
