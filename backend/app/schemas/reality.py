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


class NodeScanRequest(BaseModel):
    # neighbors: names found on the node's own /24; list: the built-in
    # candidates; custom: only the names given in `hosts`.
    mode: str = Field(default="neighbors", pattern="^(neighbors|list|custom)$")
    hosts: list[str] = Field(default_factory=list, max_length=50)
    test_top: int = Field(default=20, ge=1, le=20)
    # neighbors only: walk out to the next ring of /24s and skip every name
    # already found on this node, instead of re-reading the same ones.
    more: bool = False


class NodeCheckRequest(BaseModel):
    host: str = Field(min_length=3, max_length=253, pattern=r"^[A-Za-z0-9.-]+$")


class RemoteScanRequest(BaseModel):
    # A server that isn't a node yet; neighbors or the built-in list.
    address: str = Field(min_length=7, max_length=64)
    mode: str = Field(default="neighbors", pattern="^(neighbors|list)$")
    test_top: int = Field(default=20, ge=1, le=20)

