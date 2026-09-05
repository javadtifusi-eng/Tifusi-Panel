from fastapi import APIRouter, Depends

from app.dependencies import get_current_admin
from app.reality.scanner import is_reality_ready, scan_targets
from app.reality.targets import CANDIDATE_TARGETS
from app.schemas.reality import RealityScanRequest, RealityScanResponse, RealityScanResult

router = APIRouter(prefix="/api/reality", tags=["reality"], dependencies=[Depends(get_current_admin)])


@router.get("/targets")
async def list_candidate_targets() -> dict:
    return {"targets": CANDIDATE_TARGETS, "count": len(CANDIDATE_TARGETS)}


@router.post("/scan", response_model=RealityScanResponse)
async def scan(payload: RealityScanRequest) -> RealityScanResponse:
    hosts = payload.targets if payload.targets else CANDIDATE_TARGETS
    if payload.sample_size:
        hosts = hosts[: payload.sample_size]

    raw_results = await scan_targets(hosts)

    usable = [r for r in raw_results if is_reality_ready(r)]
    usable.sort(key=lambda r: r.latency_ms or float("inf"))
    best_host = usable[0].host if usable else None

    results = [
        RealityScanResult(
            host=r.host,
            reachable=r.reachable,
            tls_version=r.tls_version,
            alpn=r.alpn,
            latency_ms=r.latency_ms,
            error=r.error,
            recommended=(r.host == best_host),
        )
        for r in raw_results
    ]
    # Surface usable targets first, fastest first; unusable ones trail at the end.
    results.sort(key=lambda r: (not r.recommended, r.latency_ms is None, r.latency_ms or 0))

    return RealityScanResponse(scanned=len(raw_results), usable=len(usable), results=results)
