"""REALITY scan for an Iranian operator.

Nothing outside Iran can tell whether an operator throttles a name, so the
work is split three ways:

- the node gathers names worth testing (node_agent/reality_candidates.py)
  and opens throwaway inbounds for them (node_agent/reality_field.py);
- the probe (backend/reality_probe), run on the operator itself — a phone in
  Termux or a laptop — measures upload through each one;
- this router ties them together under one unguessable token and keeps the
  results, so the names that worked feed the next scan.

Every name gets an inbound of its own with dest = that site, exactly like a
real one: a target answers only for its own names, so one inbound cannot
carry many. Round 1 gives every candidate a few seconds of upload, chrome
only. The probe then asks for round 2 with its best names: each again, plus
the very best on the standard ports, and it tries fingerprints on the top.
"""

import asyncio
import base64
import secrets
import socket
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.models.reality_result import RealityResult
from app.network_health.operators import operator_for_ip
from app.subscription.lookup import client_ip

router = APIRouter(prefix="/api/reality", tags=["reality"], dependencies=[Depends(require_permission("cores"))])
public_router = APIRouter(prefix="/api/reality/run", tags=["reality"])

_TTL = 2400
_ROUND1_MAX = 80
_ROUND2_MAX = 8
_SHARED_PORTS = [8443, 2053]
# No "android": Xray's client cannot complete a REALITY handshake with it.
FINGERPRINTS = ["chrome", "firefox", "safari", "ios", "edge"]
# The name that works on MCI today; always worth a place in the next scan.
_KNOWN_GOOD = ["dynu.com"]

# One scan at a time, held in memory: a panel restart just ends it.
_run: dict | None = None


async def _node_call(node: Node, method: str, path: str, *, json: dict | None = None, timeout: float = 15.0) -> dict:
    url = f"https://{node.address}:{node.port}{path}"
    try:
        # verify=False: the node's certificate is self-signed (node_agent/tls.py).
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            resp = await client.request(method, url, json=json, headers={"X-Node-Api-Key": node.api_key})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Node unreachable: {exc.__class__.__name__}") from exc
    if resp.status_code == 404:
        raise HTTPException(status_code=409, detail="This node runs an older agent without the REALITY scan — update the node first")
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


async def _winners(db: AsyncSession) -> list[str]:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = await db.execute(
        select(RealityResult.sni).where(RealityResult.ok, RealityResult.round == 2, RealityResult.run_at >= since)
        .order_by(RealityResult.up_bps.desc()).limit(200)
    )
    return list(dict.fromkeys([*_KNOWN_GOOD, *rows.scalars()]))[:40]


def _current(token: str) -> dict:
    if _run is None or not secrets.compare_digest(_run["token"], token) or time.time() > _run["expires_at"]:
        raise HTTPException(status_code=404, detail="expired")
    return _run


async def _collect(run: dict, node: Node, winners: list[str]) -> None:
    """Background: gather candidates on the node, then open round 1."""
    try:
        found = await _node_call(node, "POST", "/reality/candidates", json={"winners": winners}, timeout=240.0)
        cands = found.get("candidates") or []
        # Winners and controls first so a cap never drops them.
        cands = cands[:_ROUND1_MAX]
        if not cands:
            raise HTTPException(status_code=502, detail="the node found no usable names")
        run["names"] = {c["host"]: {"source": c.get("source"), "label": c.get("label"), "cdn": c.get("cdn")} for c in cands}
        test = await _node_call(node, "POST", "/reality/field-test", timeout=30.0, json={
            "items": [{"hosts": [h], "label": "round1"} for h in run["names"]],
            "ttl": _TTL, "public_ip": run["public_ip"],
        })
        run.update(test=test, round=1, state="ready")
    except HTTPException as exc:
        run.update(state="failed", error=str(exc.detail))
    except Exception as exc:  # noqa: BLE001 - surfaced to the probe and the panel
        run.update(state="failed", error=exc.__class__.__name__)


def _configs(run: dict) -> list[dict]:
    test = run.get("test") or {}
    out = []
    for it in test.get("items", []):
        for host in it["hosts"]:
            meta = run["names"].get(host, {})
            out.append({"sni": host, "port": it["port"], "standard": it.get("label") == "standard",
                        "source": meta.get("source"), "label": meta.get("label")})
    return out


def _plan(run: dict) -> dict:
    test = run.get("test") or {}
    return {
        "state": run["state"], "error": run.get("error"), "round": run.get("round", 0), "run_id": run["run_id"],
        "address": run["address"], "uuid": test.get("uuid"), "public_key": test.get("public_key"),
        "short_id": test.get("short_id"), "fingerprints": FINGERPRINTS,
        "configs": _configs(run) if run["state"] == "ready" else [],
        "expires_at": run["expires_at"],
    }


@router.post("/nodes/{node_id}/scan")
async def start_scan(node_id: int, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    global _run
    node = await db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    await stop_scan(db)
    public_ip = await _public_ipv4(node.address)
    token = secrets.token_urlsafe(18)
    _run = {
        "token": token, "run_id": secrets.token_hex(6), "node_id": node.id, "public_ip": public_ip,
        # The probe dials the node directly, never through a CDN in front of its name.
        "address": public_ip or node.address, "state": "collecting", "names": {},
        "started_at": time.time(), "expires_at": time.time() + _TTL,
    }
    _run["task"] = asyncio.create_task(_collect(_run, node, await _winners(db)))
    return await scan_status()


@router.get("/scan")
async def scan_status() -> dict:
    if _run is None or time.time() > _run["expires_at"]:
        return {"state": "idle"}
    plan = _plan(_run)
    return {**plan, "token": _run["token"], "node_id": _run["node_id"], "count": len(plan["configs"])}


@router.delete("/scan")
async def stop_scan(db: AsyncSession = Depends(get_db)) -> dict:
    global _run
    run, _run = _run, None
    if run is not None:
        run["task"].cancel()
        node = await db.get(Node, run["node_id"])
        if node is not None:
            try:
                await _node_call(node, "DELETE", "/reality/field-test")
            except HTTPException:
                pass
    return {"state": "idle"}


@router.get("/results")
async def results(days: int = 14, db: AsyncSession = Depends(get_db)) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 90)))
    rows = (await db.execute(
        select(RealityResult).where(RealityResult.run_at >= since).order_by(RealityResult.run_at.desc()).limit(3000)
    )).scalars().all()
    return {"results": [{
        "run_at": r.run_at.isoformat(), "run_id": r.run_id, "round": r.round, "operator": r.operator,
        "sni": r.sni, "source": r.source, "label": r.label, "port": r.port, "fingerprint": r.fingerprint,
        "ok": r.ok, "delay_ms": r.delay_ms, "up_bps": r.up_bps, "down_bps": r.down_bps, "error": r.error,
    } for r in rows]}


# --- for the probe: the token is the credential, and it dies with the run ---

@public_router.get("/{token}")
async def probe_plan(token: str) -> dict:
    return _plan(_current(token))


@public_router.post("/{token}/round2")
async def probe_round2(token: str, body: dict = Body(...)) -> dict:
    run = _current(token)
    if run["state"] != "ready":
        raise HTTPException(status_code=409, detail="round 1 is not ready")
    hosts = [h for h in dict.fromkeys(str(h).strip().lower() for h in body.get("hosts") or []) if h in run["names"]]
    hosts = hosts[:_ROUND2_MAX]
    if not hosts:
        raise HTTPException(status_code=400, detail="no names from round 1")
    async with async_session() as db:
        node = await db.get(Node, run["node_id"])
    if node is None:
        raise HTTPException(status_code=404, detail="expired")
    # Each name again on a port of its own, plus the best one on each
    # standard port, to see whether the port itself matters.
    items = [{"hosts": [h], "label": "own"} for h in hosts]
    items += [{"hosts": [hosts[0]], "port": p, "label": "standard"} for p in _SHARED_PORTS]
    run["test"] = await _node_call(node, "POST", "/reality/field-test", timeout=30.0, json={
        "items": items, "ttl": max(300, int(run["expires_at"] - time.time())), "public_ip": run["public_ip"],
        # The probe is talking to us through a round-1 inbound right now.
        "keep_previous": True,
    })
    run["round"] = 2
    return _plan(run)


@public_router.post("/{token}/results")
async def probe_results(token: str, request: Request, body: dict = Body(...)) -> dict:
    run = _current(token)
    # The probe sends the address it has on the operator, read directly: the
    # report itself may arrive through the node.
    ip = str(body.get("client_ip") or "").strip()[:64] or client_ip(request)
    operator = operator_for_ip(ip)
    rnd = 2 if body.get("round") == 2 else 1
    rows = []
    for r in (body.get("results") or [])[:500]:
        if not isinstance(r, dict) or not r.get("sni"):
            continue
        sni = str(r["sni"]).lower()[:255]
        meta = run["names"].get(sni, {})

        def num(key: str) -> int | None:
            v = r.get(key)
            return int(v) if isinstance(v, (int, float)) and v >= 0 else None

        rows.append(RealityResult(
            run_id=run["run_id"], node_id=run["node_id"], round=rnd, client_ip=(ip or "")[:64] or None,
            operator=operator, sni=sni, source=meta.get("source"), label=(meta.get("label") or None),
            port=int(r.get("port") or 0), fingerprint=str(r.get("fingerprint") or "chrome")[:32],
            ok=bool(r.get("ok")), delay_ms=num("delay_ms"), up_bps=num("up_bps"), down_bps=num("down_bps"),
            error=(str(r.get("error"))[:200] if r.get("error") else None),
        ))
    async with async_session() as db:
        db.add_all(rows)
        await db.commit()
    return {"saved": len(rows), "operator": operator}


@public_router.get("/{token}/sub", response_class=PlainTextResponse)
async def probe_sub(token: str) -> str:
    """The same configs as vless:// links, for a manual check in v2rayNG."""
    plan = _plan(_current(token))
    links = []
    for c in plan["configs"]:
        params = {"type": "tcp", "flow": "xtls-rprx-vision", "security": "reality", "encryption": "none",
                  "sni": c["sni"], "fp": "chrome", "pbk": plan["public_key"], "sid": plan["short_id"]}
        links.append(f"vless://{plan['uuid']}@{plan['address']}:{c['port']}?{urlencode(params)}#{quote(c['sni'] + ' :' + str(c['port']))}")
    return base64.b64encode("\n".join(links).encode()).decode()


# The probe binaries (backend/reality_probe), built into the panel image.
# Public like the run endpoints: the program holds no secret, and Termux on
# the admin's phone has no panel login.
_PROBE_DIR = Path(__file__).resolve().parents[2] / "reality_probe" / "dist"
_PROBE_FILES = {"tifusi-probe-arm64", "tifusi-probe-amd64", "TifusiProbe.exe"}
probe_download_router = APIRouter(prefix="/api/reality/probe", tags=["reality"])


@probe_download_router.get("/{name}")
async def download_probe(name: str) -> FileResponse:
    path = _PROBE_DIR / name
    if name not in _PROBE_FILES or not path.is_file():
        raise HTTPException(status_code=404, detail="not built into this panel image")
    return FileResponse(path, media_type="application/octet-stream", filename=name)
