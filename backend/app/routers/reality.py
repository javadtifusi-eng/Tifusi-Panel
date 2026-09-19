import asyncio
import ipaddress
import json
import secrets
import socket
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.reality import iran_check
from app.reality.scanner import is_reality_ready, scan_targets
from app.reality.targets import CANDIDATE_TARGETS
from app.schemas.reality import NodeCheckRequest, NodeScanRequest, RemoteScanRequest, RealityScanRequest, RealityScanResponse, RealityScanResult

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


def _with_iran(scan: dict, node: Node | None = None, address: str | None = None) -> dict:
    tested = [r for r in scan.get("results", []) if r.get("fingerprints") and any((v or {}).get("ok") for v in r["fingerprints"].values())]
    for r in tested[:_IRAN_CHECKS_PER_SCAN]:
        iran_check.start_sni(r["host"])
    for r in scan.get("results", []):
        cached = iran_check.cached_only("http", f"https://{r['host']}")
        r["iran"] = cached or ({"verdict": "checking"} if iran_check.pending("http", f"https://{r['host']}") else None)
    target = f"{node.address}:{node.port}" if node else f"{address}:22"
    scan["node_iran"] = iran_check.cached_only("tcp", target) or {"verdict": "checking"}
    return scan


# Per node: how far out the neighbour scan has walked and every name it has
# already turned up. Every search goes one ring further and skips what was
# already shown, so a search never repeats the last one's sites. Kept on disk
# so a panel restart doesn't send the next search back to the first /24.
_ROUNDS_FILE = Path(__file__).resolve().parents[2] / "data" / "reality_rounds.json"


def _load_rounds() -> dict[int, dict]:
    try:
        raw = json.loads(_ROUNDS_FILE.read_text())
        return {int(k): {"ring": int(v["ring"]), "seen": set(v["seen"])} for k, v in raw.items()}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def _save_rounds() -> None:
    try:
        _ROUNDS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _ROUNDS_FILE.write_text(json.dumps({k: {"ring": v["ring"], "seen": sorted(v["seen"])} for k, v in _rounds.items()}))
    except OSError:
        pass


_rounds: dict[int, dict] = _load_rounds()


@router.post("/nodes/{node_id}/scan")
async def start_node_scan(node_id: int, payload: NodeScanRequest, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    hosts = [h.strip().lower() for h in payload.hosts if h.strip()]
    if payload.mode == "list":
        hosts = CANDIDATE_TARGETS
    elif payload.mode == "custom" and not hosts:
        raise HTTPException(status_code=400, detail="Enter at least one name to test")
    rounds = _rounds.setdefault(node.id, {"ring": 0, "seen": set()})
    if payload.mode == "neighbors" and not rounds["seen"]:
        # First search since this file existed: count whatever the node
        # already found as seen, so this one still moves on.
        try:
            last = await _node_call(node, "GET", "/reality/scan")
            rounds["seen"].update(r["host"] for r in last.get("results", []) if r.get("source") == "neighbor")
            rounds["ring"] = int(last.get("ring") or 0)
        except HTTPException:
            pass
    if payload.mode == "neighbors" and rounds["seen"]:
        rounds["ring"] += 1
    _save_rounds()
    body = {
        "public_ip": await _public_ipv4(node.address),
        "hosts": hosts,
        "neighbors": payload.mode == "neighbors",
        "test_top": payload.test_top,
        "ring": rounds["ring"],
        "exclude": sorted(rounds["seen"]),
    }
    scan = await _node_call(node, "POST", "/reality/scan", json=body)
    # Whether the node itself is reachable from Iran is worth knowing
    # before any SNI is: a blocked address makes every SNI moot.
    asyncio.get_running_loop().create_task(iran_check.address(node.address, node.port))
    return _with_iran(scan, node)


@router.get("/nodes/{node_id}/scan")
async def node_scan_status(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    scan = await _node_call(node, "GET", "/reality/scan")
    rounds = _rounds.setdefault(node.id, {"ring": 0, "seen": set()})
    fresh = {r["host"] for r in scan.get("results", []) if r.get("source") == "neighbor"} - rounds["seen"]
    if fresh:
        rounds["seen"].update(fresh)
        _save_rounds()
    scan["seen_total"] = len(rounds["seen"])
    return _with_iran(scan, node)


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


# --- a server that isn't a node yet ---------------------------------------
#
# The admin gets a one-line command for the new server; it runs the node
# agent's own scanner there (node_agent/reality_scan.py) and reports back
# with a one-time token, so targets are measured from the machine that will
# actually be the node — before it is one.

_REMOTE_TTL = 3600
_remote: dict[str, dict] = {}
_NODE_IMAGE = "ghcr.io/javadtifusi-eng/tifusi-node-agent:latest"

# The job/report endpoints are called by the new server, which has no panel
# login — the unguessable token in the path is the credential.
public_router = APIRouter(prefix="/api/reality/remote", tags=["reality"])


def _remote_or_404(token: str) -> dict:
    job = _remote.get(token)
    if job is None or time.time() - job["created"] > _REMOTE_TTL:
        _remote.pop(token, None)
        raise HTTPException(status_code=404, detail="This scan has expired — start a new one")
    return job


@router.post("/remote")
async def start_remote_scan(payload: RemoteScanRequest, request: Request) -> dict:
    try:
        ip = ipaddress.IPv4Address(payload.address.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter the server's public IPv4 address") from None
    if not ip.is_global:
        raise HTTPException(status_code=400, detail="That is not a public address")
    for t in [t for t, j in _remote.items() if time.time() - j["created"] > _REMOTE_TTL]:
        _remote.pop(t, None)
    token = secrets.token_urlsafe(24)
    _remote[token] = {
        "created": time.time(),
        "address": str(ip),
        "spec": {
            "public_ip": str(ip),
            "hosts": CANDIDATE_TARGETS if payload.mode == "list" else [],
            "neighbors": payload.mode == "neighbors",
            "test_top": payload.test_top,
        },
        "scan": {"state": "waiting", "phase_total": 0, "phase_done": 0, "results": [], "error": None},
    }
    base = (settings.public_url or str(request.base_url)).rstrip("/")
    url = f"{base}/api/reality/remote/{token}"
    command = (
        "command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh; "
        f"docker run --rm --network host {_NODE_IMAGE} python -m node_agent.reality_scan --job {url}"
    )
    asyncio.get_running_loop().create_task(iran_check.address(str(ip), 22))
    return {"token": token, "command": command}


@router.get("/remote/{token}")
async def remote_scan_status(token: str) -> dict:
    job = _remote_or_404(token)
    scan = dict(job["scan"])
    scan["results"] = [dict(r) for r in scan.get("results", [])]
    return _with_iran(scan, address=job["address"])


@public_router.get("/{token}/job")
async def remote_scan_job(token: str) -> dict:
    return _remote_or_404(token)["spec"]


@public_router.post("/{token}/report")
async def remote_scan_report(token: str, body: dict = Body(...)) -> dict:
    job = _remote_or_404(token)
    results = body.get("results")
    if not isinstance(results, list) or len(results) > 600:
        raise HTTPException(status_code=400, detail="bad report")
    job["scan"] = {
        "state": str(body.get("state") or "")[:20],
        "phase_total": int(body.get("phase_total") or 0),
        "phase_done": int(body.get("phase_done") or 0),
        "error": (str(body["error"])[:300] if body.get("error") else None),
        "results": [r for r in results if isinstance(r, dict)],
    }
    return {"ok": True}

