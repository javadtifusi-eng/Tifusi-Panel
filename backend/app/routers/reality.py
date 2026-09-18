import asyncio
import socket

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.reality import iran_check
from app.reality.scanner import is_reality_ready, scan_targets
from app.reality.targets import CANDIDATE_TARGETS
from app.schemas.reality import NodeCheckRequest, NodeScanRequest, RealityScanRequest, RealityScanResponse, RealityScanResult

router = APIRouter(prefix="/api/reality", tags=["reality"], dependencies=[Depends(require_permission("cores"))])


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


# --- scanning on a node (node_agent/reality_scan.py) -----------------------

# How many of the best names get an Iran check per scan: check-host.net is a
# shared free service, so the panel asks about the finalists only.
_IRAN_CHECKS_PER_SCAN = 8


async def _node_or_404(node_id: int, db: AsyncSession) -> Node:
    node = await db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


async def _node_call(node: Node, method: str, path: str, *, json: dict | None = None, timeout: float = 10.0) -> dict:
    url = f"https://{node.address}:{node.port}{path}"
    try:
        # verify=False: the node's certificate is self-signed (node_agent/tls.py).
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            resp = await client.request(method, url, json=json, headers={"X-Node-Api-Key": node.api_key})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Node unreachable: {exc.__class__.__name__}") from exc
    if resp.status_code == 404:
        raise HTTPException(status_code=409, detail="This node runs an older agent without the scanner — update the node first")
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail")
        except ValueError:
            detail = None
        raise HTTPException(status_code=resp.status_code, detail=detail or f"Node returned HTTP {resp.status_code}")
    return resp.json()


async def _public_ipv4(address: str) -> str | None:
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, address, 443, socket.AF_INET)
    except OSError:
        return None
    return infos[0][4][0] if infos else None


def _with_iran(scan: dict, node: Node) -> dict:
    tested = [r for r in scan.get("results", []) if r.get("fingerprints") and any((v or {}).get("ok") for v in r["fingerprints"].values())]
    for r in tested[:_IRAN_CHECKS_PER_SCAN]:
        iran_check.start_sni(r["host"])
    for r in scan.get("results", []):
        cached = iran_check.cached_only("http", f"https://{r['host']}")
        r["iran"] = cached or ({"verdict": "checking"} if iran_check.pending("http", f"https://{r['host']}") else None)
    scan["node_iran"] = iran_check.cached_only("tcp", f"{node.address}:{node.port}") or {"verdict": "checking"}
    return scan


@router.post("/nodes/{node_id}/scan")
async def start_node_scan(node_id: int, payload: NodeScanRequest, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    hosts = [h.strip().lower() for h in payload.hosts if h.strip()]
    if payload.mode == "list":
        hosts = CANDIDATE_TARGETS
    elif payload.mode == "custom" and not hosts:
        raise HTTPException(status_code=400, detail="Enter at least one name to test")
    body = {
        "public_ip": await _public_ipv4(node.address),
        "hosts": hosts,
        "neighbors": payload.mode == "neighbors",
        "test_top": payload.test_top,
    }
    scan = await _node_call(node, "POST", "/reality/scan", json=body)
    # Whether the node itself is reachable from Iran is worth knowing
    # before any SNI is: a blocked address makes every SNI moot.
    asyncio.get_running_loop().create_task(iran_check.address(node.address, node.port))
    return _with_iran(scan, node)


@router.get("/nodes/{node_id}/scan")
async def node_scan_status(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    return _with_iran(await _node_call(node, "GET", "/reality/scan"), node)


@router.post("/nodes/{node_id}/check")
async def check_one(node_id: int, payload: NodeCheckRequest, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    host = payload.host.strip().lower()
    result, iran = await asyncio.gather(
        _node_call(node, "POST", "/reality/check", json={"host": host}, timeout=60.0),
        iran_check.sni(host),
    )
    result["iran"] = iran
    return result
