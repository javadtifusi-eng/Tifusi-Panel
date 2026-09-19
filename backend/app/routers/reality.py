"""Finding a REALITY camouflage target for a node.

One flow, and it is live every time: the node reads the names off the
certificates of its own datacenter neighbours (node_agent/reality_scan.py),
this router asks probes inside Iran which of those are really open there
and how fast they answer, and only those go back to the node for the
per-fingerprint REALITY test. There is deliberately no built-in list of
names anywhere — a published target is the first one a censor blocks, and
a name that is excellent on one server's network is ordinary on another's.

Ranking is by working well, not by reachability: connecting at all is the
minimum bar. The node load-tests each finalist the way REALITY will really
use it — a handshake per user connection, all day — because a target that
drops handshakes under load or shuts the node out breaks users however fast
it is idle. After that come how fast Iran reaches the name and the node->
target handshake. The last word belongs to the field test at the bottom of
this file, where a real phone on Iranian internet measures real throughput.
"""

import asyncio
import base64
import ipaddress
import json
import secrets
import socket
import ssl
from contextlib import suppress
from urllib.parse import quote, urlencode, urlparse
from pathlib import Path

import certifi
import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.host import Host
from app.models.node import Node
from app.network_health.operators import operator_for_ip
from app.reality import iran_check
from app.subscription.lookup import client_ip

router = APIRouter(prefix="/api/reality", tags=["reality"], dependencies=[Depends(require_permission("cores"))])


# How many names get an Iran check per scan: check-host.net is a shared free
# service, so the nearest survivors are asked about and the rest wait for the
# next round rather than queueing behind them.
_IRAN_CHECKS_PER_SCAN = 30

# How many Iran-open names get the per-fingerprint REALITY test and the load
# test. Each costs the node a little over a minute (ten fingerprints, four
# fetches each, then about twenty seconds of load), so it is the fastest
# handful rather than everything that passed.
_PROVE_TOP = 8


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


def _iran_ms(r: dict) -> int:
    """How long Iran took to reach the name — the speed signal a scan has
    before any phone is involved. Unknown sorts last, never first."""
    ms = (r.get("iran") or {}).get("ms")
    return ms if ms is not None else 10**6


def _with_iran(scan: dict, node: Node) -> dict:
    # Every name that survived validation is asked about, because being open
    # in Iran is the one condition that cannot be traded away: it decides
    # which names are worth testing, rather than being a label added to the
    # results afterwards. The quickest from the node go first, so the cap
    # below falls on the names least likely to be wanted anyway.
    survivors = sorted(
        [r for r in scan.get("results", []) if r.get("usable")],
        key=lambda r: r.get("latency_ms") or 10**6,
    )
    for r in survivors[:_IRAN_CHECKS_PER_SCAN]:
        iran_check.start_sni(r["host"])
    for r in scan.get("results", []):
        cached = iran_check.cached_only("http", f"https://{r['host']}")
        r["iran"] = cached or ({"verdict": "checking"} if iran_check.pending("http", f"https://{r['host']}") else None)
    scan["node_iran"] = iran_check.cached_only("tcp", f"{node.address}:{node.port}") or {"verdict": "checking"}
    return scan


# One handover per scan, keyed by the node's own start time for it: a re-scan
# gets a fresh key, a repeated poll does not.
_proved: dict[int, str] = {}


async def _maybe_prove(node: Node, scan: dict) -> dict:
    """The node parks in `checking` once it has validated and timed its
    finds. When Iran has answered for all of them, hand the open ones back —
    fastest from Iran first — for the per-fingerprint test. A name Iran
    blocks is never tested: it could not be used whatever the result."""
    if scan.get("state") != "checking":
        return scan
    survivors = [r for r in scan.get("results", []) if r.get("usable")]
    if any((r.get("iran") or {}).get("verdict") == "checking" for r in survivors):
        return scan
    key = str(scan.get("started_at"))
    if _proved.get(node.id) == key:
        return scan
    _proved[node.id] = key
    ready = sorted(
        [r for r in survivors if (r.get("iran") or {}).get("verdict") == "open"],
        key=lambda r: (_iran_ms(r), r.get("latency_ms") or 10**6),
    )[:_PROVE_TOP]
    try:
        return await _node_call(node, "POST", "/reality/prove", json={"hosts": [r["host"] for r in ready]})
    except HTTPException as exc:
        scan["error"] = str(exc.detail)
        return scan


# Per node: how far out the scan has walked and every name it has already
# turned up. Every search goes one ring further and skips what was already
# shown, so a search never repeats the last one's sites. Kept on disk so a
# panel restart doesn't send the next search back to the first /24.
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
async def start_node_scan(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    rounds = _rounds.setdefault(node.id, {"ring": 0, "seen": set()})
    if not rounds["seen"]:
        # First search since this file existed: count whatever the node
        # already found as seen, so this one still moves on.
        try:
            last = await _node_call(node, "GET", "/reality/scan")
            rounds["seen"].update(r["host"] for r in last.get("results", []))
            rounds["ring"] = int(last.get("ring") or 0)
        except HTTPException:
            pass
    if rounds["seen"]:
        rounds["ring"] += 1
    _save_rounds()
    scan = await _node_call(node, "POST", "/reality/scan", json={
        "public_ip": await _public_ipv4(node.address),
        "ring": rounds["ring"],
        "exclude": sorted(rounds["seen"]),
    })
    # Whether the node itself is reachable from Iran is worth knowing
    # before any SNI is: a blocked address makes every SNI moot.
    asyncio.get_running_loop().create_task(iran_check.address(node.address, node.port))
    return _with_iran(scan, node)


@router.get("/nodes/{node_id}/scan")
async def node_scan_status(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    scan = await _node_call(node, "GET", "/reality/scan")
    rounds = _rounds.setdefault(node.id, {"ring": 0, "seen": set()})
    fresh = {r["host"] for r in scan.get("results", [])} - rounds["seen"]
    if fresh:
        rounds["seen"].update(fresh)
        _save_rounds()
    # The verdicts have to be on the results before _maybe_prove can read
    # them; when it does hand over, it returns the node's fresh status, which
    # needs them again. The second pass is free — the answers are cached.
    scan = await _maybe_prove(node, _with_iran(scan, node))
    scan = _with_iran(scan, node)
    scan["seen_total"] = len(rounds["seen"])
    return scan


# --- test from the admin's own device ------------------------------------
#
# check-host.net's Iranian probes all sit in datacenters, so a name they find
# open can still be filtered or throttled on a mobile operator — the gap
# between "works on TCI" and "not on MCI". The admin's own browser, on
# whatever network the laptop is on, is the vantage point that closes it:
# the dashboard fetches each finalist from there (RealityScanner.tsx) and
# this says which operator that is, so each result is labelled with it —
# and so a browser that is really going out through a VPN is caught rather
# than reported as Iran.

@router.get("/whoami")
async def whoami(request: Request) -> dict:
    ip = client_ip(request)
    return {"ip": ip, "operator": operator_for_ip(ip)}


# --- the node's own names (for the operator-pattern test) ----------------
#
# Every neighbour SNI shares one weakness: the client connects to the node's
# address while the SNI's own DNS points somewhere else. A censor that
# resolves the SNI and compares sees that mismatch on all of them alike, so no
# neighbour can show whether it matters. A name of the admin's own that
# resolves to the node — and is served with a real certificate there — is the
# one SNI without it, which makes it the control in that test.

async def _serves_tls13(ip: str, name: str) -> bool:
    ctx = ssl.create_default_context(cafile=certifi.where())
    ctx.set_alpn_protocols(["h2", "http/1.1"])
    writer = None
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ip, 443, ssl=ctx, server_hostname=name), timeout=6)
        return writer.get_extra_info("ssl_object").version() == "TLSv1.3"
    except (OSError, asyncio.TimeoutError, ssl.SSLError):
        return False
    finally:
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()


@router.get("/nodes/{node_id}/own-names")
async def own_names(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    node_ip = await _public_ipv4(node.address)
    names = {node.address, *(await db.execute(select(Host.address))).scalars().all()}
    if settings.public_url:
        names.add(urlparse(settings.public_url).hostname)
    out = []
    for name in sorted(n.strip().lower() for n in names if n):
        with suppress(ValueError):
            ipaddress.ip_address(name)
            continue
        if node_ip and await _public_ipv4(name) == node_ip and await _serves_tls13(node_ip, name):
            out.append({"host": name, "dest": f"{node_ip}:443"})
    return {"names": out}


# --- real test from inside Iran (node_agent/field_test.py) ----------------
#
# Only a client on Iranian internet can measure what an SNI is actually
# worth: DPI throttles names it does not block, so a target can pass every
# check here and still crawl. The node opens one throwaway inbound per SNI;
# the admin imports the subscription below on a phone in Iran and runs a
# speed test, and the node reports the real rate each one carried.

_FIELD_TTL = 1800
_field: dict[int, str] = {}  # node id -> subscription token
_field_tokens: dict[str, int] = {}


def _field_links(node: Node, test: dict) -> list[dict]:
    items = []
    for it in test.get("items", []):
        params = {
            "type": "tcp", "security": "reality", "encryption": "none", "flow": "xtls-rprx-vision",
            "sni": it["host"], "fp": "chrome", "pbk": test.get("public_key", ""), "sid": test.get("short_id", ""),
        }
        link = f"vless://{test.get('uuid')}@{node.address}:{it['port']}?{urlencode(params)}#{quote('TEST ' + it['host'])}"
        items.append({**it, "link": link})
    return items


def _field_view(node: Node, test: dict, request: Request) -> dict:
    token = _field.get(node.id)
    base = (settings.public_url or str(request.base_url)).rstrip("/")
    items = _field_links(node, test) if test.get("uuid") else []
    for it in items:
        # Which operator each connection came from, not the addresses
        # themselves: that is all the dashboard needs to label a result.
        it["operators"] = sorted({operator_for_ip(ip) or "unknown" for ip in it.pop("ips", None) or []})
    return {
        **{k: test.get(k) for k in ("active", "started_at", "expires_at")},
        "items": items,
        "sub_url": f"{base}/api/reality/field/{token}" if token and test.get("active") else None,
    }


@router.post("/nodes/{node_id}/field-test")
async def start_field_test(node_id: int, request: Request, body: dict = Body(...), db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    targets = [
        {"host": str(t.get("host") or "").strip().lower(), "dest": t.get("dest"),
         "port": t.get("port") if isinstance(t.get("port"), int) else None, "label": t.get("label")}
        for t in (body.get("targets") or []) if isinstance(t, dict) and t.get("host")
    ][:12]
    if not targets:
        raise HTTPException(status_code=400, detail="Pick at least one site to test")
    test = await _node_call(node, "POST", "/reality/field-test", timeout=20.0, json={
        "targets": targets, "ttl": _FIELD_TTL, "public_ip": await _public_ipv4(node.address),
    })
    old = _field.pop(node.id, None)
    if old:
        _field_tokens.pop(old, None)
    token = secrets.token_urlsafe(18)
    _field[node.id], _field_tokens[token] = token, node.id
    return _field_view(node, test, request)


@router.get("/nodes/{node_id}/field-test")
async def field_test_status(node_id: int, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    return _field_view(node, await _node_call(node, "GET", "/reality/field-test"), request)


@router.delete("/nodes/{node_id}/field-test")
async def stop_field_test(node_id: int, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    test = await _node_call(node, "DELETE", "/reality/field-test")
    _field_tokens.pop(_field.pop(node.id, ""), None)
    return _field_view(node, test, request)


# Imported by v2rayNG/Hiddify on the admin's phone, which has no panel
# login: the unguessable token is the credential, and it dies with the test.
field_public_router = APIRouter(prefix="/api/reality/field", tags=["reality"])


@field_public_router.get("/{token}", response_class=PlainTextResponse)
async def field_test_subscription(token: str, db: AsyncSession = Depends(get_db)) -> str:
    node_id = _field_tokens.get(token)
    node = await db.get(Node, node_id) if node_id else None
    if node is None:
        raise HTTPException(status_code=404, detail="expired")
    test = await _node_call(node, "GET", "/reality/field-test")
    if not test.get("active"):
        raise HTTPException(status_code=404, detail="expired")
    links = "\n".join(i["link"] for i in _field_links(node, test))
    return base64.b64encode(links.encode()).decode()
