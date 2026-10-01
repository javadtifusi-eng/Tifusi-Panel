"""REALITY field test: throwaway inbounds for the Windows probe.

The panel no longer scans for targets itself. The Windows probe
(backend/reality_probe) picks names on the admin's own operator and asks for
a field test here; the node opens one short-lived inbound per name
(node_agent/field_test.py) and the probe measures real upload through each,
from the network that actually throttles it.
"""

import asyncio
import base64
import json
import secrets
import socket
from urllib.parse import quote, urlencode
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.network_health.operators import operator_for_ip
from app.settings_store import get_subscription_url

router = APIRouter(prefix="/api/reality", tags=["reality"], dependencies=[Depends(require_permission("cores"))])


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
        common = {
            "security": "reality", "encryption": "none",
            "sni": it["host"], "fp": "chrome", "pbk": test.get("public_key", ""), "sid": test.get("short_id", ""),
        }
        if it.get("transport") == "xhttp":
            # No flow: vision is raw-TCP only. mode=auto matches the inbound.
            params = {"type": "xhttp", "path": it.get("path") or "/", "mode": "auto", **common}
            label = f"TEST {it['host']} xhttp :{it['port']}"
        else:
            params = {"type": "tcp", "flow": "xtls-rprx-vision", **common}
            label = f"TEST {it['host']} :{it['port']}"
        link = f"vless://{test.get('uuid')}@{node.address}:{it['port']}?{urlencode(params)}#{quote(label)}"
        items.append({**it, "link": link})
    return items


async def _field_base(request: Request, db: AsyncSession) -> str:
    # The probe fetches this link from a laptop on an Iranian operator with the
    # VPN off, so it has to be on the customer-facing address that stays open
    # there — the panel's own domain is often the filtered one.
    return ((await get_subscription_url(db)) or settings.public_url or str(request.base_url)).rstrip("/")


def _field_view(node: Node, test: dict, base: str) -> dict:
    token = _field.get(node.id)
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
         "port": t.get("port") if isinstance(t.get("port"), int) else None, "label": t.get("label"),
         "transport": "xhttp" if t.get("transport") == "xhttp" else "tcp"}
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
    return _field_view(node, test, await _field_base(request, db))


@router.get("/nodes/{node_id}/field-test")
async def field_test_status(node_id: int, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    return _field_view(node, await _node_call(node, "GET", "/reality/field-test"), await _field_base(request, db))


@router.delete("/nodes/{node_id}/field-test")
async def stop_field_test(node_id: int, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    test = await _node_call(node, "DELETE", "/reality/field-test")
    _field_tokens.pop(_field.pop(node.id, ""), None)
    return _field_view(node, test, await _field_base(request, db))


# The Windows probe (backend/reality_probe/) measures the same field-test
# configs from the admin's laptop, once per fingerprint, upload first — the
# number a phone speed test cannot split by fingerprint. Built into the image
# by backend/Dockerfile; absent when running from the source tree.
_PROBE_ZIP = Path(__file__).resolve().parents[2] / "reality_probe" / "TifusiRealityProbe.zip"


@router.get("/probe/download")
async def download_probe() -> FileResponse:
    if not _PROBE_ZIP.is_file():
        raise HTTPException(status_code=404, detail="The Windows probe is not built into this panel image")
    return FileResponse(_PROBE_ZIP, media_type="application/zip", filename="TifusiRealityProbe.zip")


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
