"""Finding a fast, clean Cloudflare edge IP for a node.

The same shape as the REALITY scanner and the same rules. The node draws a
random sample of individual IPs from Cloudflare's own ranges, fetched live, and
times each edge's TLS handshake (node_agent/cf_scan.py). This router then asks
probes inside Iran how each surviving edge performs from there and orders the
results by that — reachability from the node is only the minimum bar, real speed
through Iran is what ranks them, exactly as for REALITY targets.

A Cloudflare edge answers every proxied domain from every address, so any IP
here serves the admin's own TLS host; the scan's job is only to say which of
those addresses are fast and open on the operator the users are actually on.
"""

import asyncio

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.network_health.operators import operator_for_ip
from app.reality import iran_check
from app.routers.reality import _node_call, _node_or_404

router = APIRouter(prefix="/api/cloudflare", tags=["cloudflare"], dependencies=[Depends(require_permission("cores"))])

# check-host.net is a shared free service, so only the fastest edges from the
# node get an Iran probe each poll; the rest wait rather than queueing behind them.
_IRAN_CHECKS_PER_SCAN = 20


def _iran_ms(r: dict) -> int:
    ms = (r.get("iran") or {}).get("ms")
    return ms if ms is not None else 10**6


def _with_iran(scan: dict) -> dict:
    """Start an Iran TCP probe for the fastest usable edges, and attach whatever
    verdict is already cached to every result. The edges quickest from the node
    go first, so the per-scan cap falls on the ones least likely to be wanted."""
    usable = sorted(
        [r for r in scan.get("results", []) if r.get("usable")],
        key=lambda r: r.get("latency_ms") or 10**6,
    )
    for r in usable[:_IRAN_CHECKS_PER_SCAN]:
        iran_check.start_address(r["ip"], 443)
    for r in scan.get("results", []):
        cached = iran_check.cached_only("tcp", f"{r['ip']}:443")
        if cached is not None:
            r["iran"] = cached
        elif iran_check.pending("tcp", f"{r['ip']}:443"):
            r["iran"] = {"verdict": "checking"}
        else:
            r["iran"] = None
        r["operator"] = operator_for_ip(r["ip"]) or None
    # Ranked the way the standing rule requires: open from Iran first, then by
    # how fast Iran reaches it, and only then by the node->edge handshake.
    scan["results"].sort(
        key=lambda r: (
            not r.get("usable"),
            (r.get("iran") or {}).get("verdict") != "open",
            _iran_ms(r),
            r.get("latency_ms") or 10**6,
        )
    )
    return scan


@router.post("/nodes/{node_id}/scan")
async def start_cf_scan(node_id: int, body: dict = Body(default=None), db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    body = body or {}
    payload = {"sample": 60}
    sni = str(body.get("sni") or "").strip().lower()
    if sni:
        payload["sni"] = sni
    scan = await _node_call(node, "POST", "/cf/scan", json=payload)
    return _with_iran(scan)


@router.get("/nodes/{node_id}/scan")
async def cf_scan_status(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _node_or_404(node_id, db)
    return _with_iran(await _node_call(node, "GET", "/cf/scan"))
