import ipaddress
import re
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.models.shield import ShieldMember
from app.models.tunnel import Tunnel, TunnelStatus, TunnelTransport
from app.schemas.tunnel import (
    CdnEdgeScan,
    CdnFrontScan,
    CdnSpeed,
    SpoofTestCommands,
    SpoofTestRequest,
    TunnelConfig,
    TunnelCreate,
    TunnelList,
    TunnelRecommendRequest,
    TunnelRecommendResult,
    TunnelResponse,
    TunnelTestResult,
    TunnelUpdate,
)
from app.tunnels.config import (
    build_foreign_config,
    build_install_command,
    build_iran_config,
    build_spooftest_commands,
)
from app.tunnels import cdn_scan
from app.tunnels.probe import cdn_probe, recommend_transports, tcp_probe

router = APIRouter(prefix="/api/tunnels", tags=["tunnels"], dependencies=[Depends(require_permission("tunnels"))])

# Used when a bare foreign address carries no probe port of its own: SSH is
# the one port such a server almost always has open, so it is the least-bad
# guess at "is this box alive" — but only a guess, hence foreign_port.
_DEFAULT_FOREIGN_PROBE_PORT = 22

# A host is only ever an IP or a DNS name here; anything with shell syntax is
# rejected before it can reach the copy-paste command string a spoof test
# builds (the admin runs that command themselves, but it should still never
# carry injected syntax).
_HOST_RE = re.compile(r"^[A-Za-z0-9.\-:]+$")


# The HTTPS ports Cloudflare proxies. It connects to the origin on the same
# port the client used, so the relay has to listen on one of these too.
_CLOUDFLARE_PORTS = (443, 2053, 2083, 2087, 2096, 8443)
_CDN_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$")


def _apply_cdn(tunnel: Tunnel) -> None:
    """Fills in everything a CDN tunnel needs from just the provider and
    hostname, so the admin never sets SNI, Host or path by hand."""
    if not tunnel.cdn_host:
        tunnel.cdn_provider = tunnel.cdn_host = tunnel.cdn_port = tunnel.cdn_front = None
        tunnel.cdn_ips = None
        return
    host = tunnel.cdn_host.strip().lower().rstrip(".")
    if not _CDN_HOST_RE.match(host):
        raise HTTPException(status_code=400, detail="CDN domain must be a hostname such as tun.example.ir")
    if tunnel.transport not in (TunnelTransport.wss, TunnelTransport.wssmux):
        raise HTTPException(status_code=400, detail="A tunnel through a CDN needs the wss or wssmux transport")
    tunnel.cdn_host = host
    tunnel.cdn_provider = tunnel.cdn_provider or "arvan"
    tunnel.sni = host
    tunnel.domain = None
    if not tunnel.path or tunnel.path == "/":
        tunnel.path = "/" + secrets.token_hex(5)
    if tunnel.cdn_provider == "cloudflare":
        port = tunnel.cdn_port or (tunnel.iran_port if tunnel.iran_port in _CLOUDFLARE_PORTS else 443)
        if port not in _CLOUDFLARE_PORTS:
            raise HTTPException(
                status_code=400,
                detail="Cloudflare only proxies HTTPS on ports " + ", ".join(map(str, _CLOUDFLARE_PORTS)),
            )
        tunnel.cdn_port = port
        tunnel.iran_port = port
    else:
        tunnel.cdn_port = tunnel.cdn_port or 443
    ips = []
    for ip in tunnel.cdn_ips or []:
        try:
            addr = ipaddress.IPv4Address(str(ip).strip())
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{ip} is not an IPv4 address") from None
        if not addr.is_global:
            raise HTTPException(status_code=400, detail=f"{ip} is not a public address")
        if str(addr) not in ips:
            ips.append(str(addr))
    tunnel.cdn_ips = ips[:5] or None
    if tunnel.cdn_front:
        front = tunnel.cdn_front.strip().lower().rstrip(".")
        if not _CDN_HOST_RE.match(front):
            raise HTTPException(status_code=400, detail="Front SNI must be a hostname")
        tunnel.cdn_front = None if front == host else front
    else:
        tunnel.cdn_front = None


def _validate_host(host: str) -> str:
    if not host or not _HOST_RE.match(host):
        raise HTTPException(status_code=400, detail="foreign address is not a valid host")
    return host


def _validate_spoof_ip(spec: str) -> None:
    """A forged source may be a single IP, an a-b range, or a CIDR block."""
    try:
        ipaddress.ip_address(spec)
        return
    except ValueError:
        pass
    try:
        ipaddress.ip_network(spec, strict=False)
        return
    except ValueError:
        pass
    if "-" in spec:
        lo, _, hi = spec.partition("-")
        try:
            ipaddress.ip_address(lo)
            ipaddress.ip_address(hi)
            return
        except ValueError:
            pass
    raise HTTPException(status_code=400, detail="spoof_ip must be an IP, range (a-b) or CIDR")


async def _resolve_foreign_node_id(node_id: int | None, db: AsyncSession) -> int | None:
    if node_id is None:
        return None
    node = await db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=400, detail="foreign_node_id not found")
    return node_id


def _validate_foreign(foreign_node_id: int | None, foreign_address: str | None) -> None:
    if not foreign_node_id and not foreign_address:
        raise HTTPException(
            status_code=400, detail="Either foreign_node_id or foreign_address is required"
        )


@router.get("", response_model=TunnelList)
async def list_tunnels(db: AsyncSession = Depends(get_db)) -> TunnelList:
    total = await db.scalar(select(func.count()).select_from(Tunnel))
    result = await db.execute(select(Tunnel).order_by(Tunnel.id.desc()))
    return TunnelList(total=total or 0, tunnels=list(result.scalars().all()))


@router.post("", response_model=TunnelResponse, status_code=201)
async def create_tunnel(payload: TunnelCreate, db: AsyncSession = Depends(get_db)) -> Tunnel:
    _validate_foreign(payload.foreign_node_id, payload.foreign_address)
    foreign_node_id = await _resolve_foreign_node_id(payload.foreign_node_id, db)

    tunnel = Tunnel(
        name=payload.name,
        iran_address=payload.iran_address,
        iran_port=payload.iran_port,
        foreign_node_id=foreign_node_id,
        foreign_address=payload.foreign_address,
        foreign_port=payload.foreign_port,
        transport=payload.transport,
        sni=payload.sni,
        domain=payload.domain,
        path=payload.path,
        connection_count=payload.connection_count,
        forwards=[f.model_dump() for f in payload.forwards],
        cdn_provider=payload.cdn_provider,
        cdn_host=payload.cdn_host,
        cdn_port=payload.cdn_port,
        cdn_ips=payload.cdn_ips,
        cdn_front=payload.cdn_front,
    )
    _apply_cdn(tunnel)
    db.add(tunnel)
    await db.commit()
    await db.refresh(tunnel)
    return tunnel


async def _get_tunnel_or_404(tunnel_id: int, db: AsyncSession) -> Tunnel:
    tunnel = await db.get(Tunnel, tunnel_id)
    if tunnel is None:
        raise HTTPException(status_code=404, detail="Tunnel not found")
    return tunnel


@router.get("/{tunnel_id}", response_model=TunnelResponse)
async def get_tunnel(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> Tunnel:
    return await _get_tunnel_or_404(tunnel_id, db)


@router.put("/{tunnel_id}", response_model=TunnelResponse)
async def update_tunnel(tunnel_id: int, payload: TunnelUpdate, db: AsyncSession = Depends(get_db)) -> Tunnel:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)

    data = payload.model_dump(exclude_unset=True, exclude={"foreign_node_id", "forwards"})
    for field, value in data.items():
        setattr(tunnel, field, value)

    if "forwards" in payload.model_fields_set and payload.forwards is not None:
        tunnel.forwards = [f.model_dump() for f in payload.forwards]

    if "foreign_node_id" in payload.model_fields_set:
        tunnel.foreign_node_id = await _resolve_foreign_node_id(payload.foreign_node_id, db)

    if tunnel.transport is TunnelTransport.udp and await db.scalar(
        select(ShieldMember.id).where(ShieldMember.tunnel_id == tunnel.id)
    ):
        raise HTTPException(status_code=400, detail="This tunnel is in a Connection Shield group, which can't health-check udp")

    _validate_foreign(tunnel.foreign_node_id, tunnel.foreign_address)
    _apply_cdn(tunnel)

    db.add(tunnel)
    await db.commit()
    await db.refresh(tunnel)
    return tunnel


@router.delete("/{tunnel_id}", status_code=204)
async def delete_tunnel(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> None:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    # SQLite doesn't enforce the ON DELETE CASCADE without a pragma.
    await db.execute(delete(ShieldMember).where(ShieldMember.tunnel_id == tunnel.id))
    await db.delete(tunnel)
    await db.commit()


@router.get("/{tunnel_id}/config", response_model=TunnelConfig)
async def get_tunnel_config(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> TunnelConfig:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    iran_config = build_iran_config(tunnel)
    foreign_config = build_foreign_config(tunnel)
    return TunnelConfig(
        iran_config=iran_config,
        foreign_config=foreign_config,
        iran_install_command=build_install_command(iran_config),
        foreign_install_command=build_install_command(foreign_config),
    )


@router.post("/recommend", response_model=TunnelRecommendResult)
async def recommend_tunnel_transport(
    payload: TunnelRecommendRequest, db: AsyncSession = Depends(get_db)
) -> TunnelRecommendResult:
    """Probes both sides before a tunnel exists (nothing is listening on
    the tunnel port yet - that only starts once the install commands
    below have actually run) and ranks transports by what's honestly
    measurable this early: raw reachability and latency to each address,
    not per-transport DPI behavior no panel can promise from outside Iran.
    """
    _validate_foreign(payload.foreign_node_id, payload.foreign_address)

    if payload.foreign_node_id is not None:
        node = await db.get(Node, payload.foreign_node_id)
        if node is None:
            raise HTTPException(status_code=400, detail="foreign_node_id not found")
        foreign_host, foreign_port = node.address, node.port
    else:
        foreign_host = payload.foreign_address
        foreign_port = payload.foreign_port or _DEFAULT_FOREIGN_PROBE_PORT

    iran_reachable, iran_latency, foreign_reachable, foreign_latency, link, ranked = (
        await recommend_transports(payload.iran_address, payload.iran_port, foreign_host, foreign_port)
    )
    return TunnelRecommendResult(
        iran_reachable=iran_reachable,
        iran_latency_ms=iran_latency,
        foreign_reachable=foreign_reachable,
        foreign_latency_ms=foreign_latency,
        link=link,
        ranked=ranked,
    )


async def _foreign_probe_target(tunnel: Tunnel, db: AsyncSession) -> tuple[str, int] | None:
    """Where to probe the tunnel's foreign side, or None if the row no
    longer says. A Node's own agent port is always meant to be open, so
    it's a far more meaningful target than any port guessed at on a bare
    address (see probe.py's note on what this check can and can't promise).
    """
    if tunnel.foreign_node_id is not None:
        node = await db.get(Node, tunnel.foreign_node_id)
        if node is not None:
            return node.address, node.port
    if tunnel.foreign_address:
        return tunnel.foreign_address, tunnel.foreign_port or _DEFAULT_FOREIGN_PROBE_PORT
    return None


@router.post("/spooftest", response_model=SpoofTestCommands)
async def spooftest_commands(
    payload: SpoofTestRequest, db: AsyncSession = Depends(get_db)
) -> SpoofTestCommands:
    """Builds the two copy-paste commands for a spoof-ability check without
    touching any server — the admin runs them on the foreign and Iran boxes
    to see whether the Iran datacenter lets a forged source IP egress at all,
    which is the precondition for any spoofing tunnel to be worth building.
    """
    _validate_foreign(payload.foreign_node_id, payload.foreign_address)

    if payload.foreign_node_id is not None:
        node = await db.get(Node, payload.foreign_node_id)
        if node is None:
            raise HTTPException(status_code=400, detail="foreign_node_id not found")
        foreign_host = node.address
    else:
        foreign_host = payload.foreign_address

    _validate_host(foreign_host)
    _validate_spoof_ip(payload.spoof_ip)

    recv, send = build_spooftest_commands(foreign_host, payload.spoof_ip, payload.port)
    return SpoofTestCommands(foreign_recv_command=recv, iran_send_command=send)


@router.post("/{tunnel_id}/test", response_model=TunnelTestResult)
async def test_tunnel(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> TunnelTestResult:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)

    # A udp tunnel listens with KCP over UDP, so a TCP connect to that port
    # fails whether or not the tunnel is healthy — skipping is honest,
    # reporting it unreachable would mark a working tunnel broken.
    if tunnel.transport is TunnelTransport.udp:
        iran_reachable, iran_latency = None, None
    else:
        iran_reachable, iran_latency = await tcp_probe(tunnel.iran_address, tunnel.iran_port)

    target = await _foreign_probe_target(tunnel, db)
    foreign_reachable, foreign_latency = await tcp_probe(*target) if target else (False, None)

    cdn_reachable = cdn_latency = cdn_error = None
    if tunnel.cdn_host:
        if tunnel.cdn_ips or tunnel.cdn_front:
            # The same edge and SNI the foreign side uses.
            cdn_reachable, cdn_latency, cdn_error = await cdn_scan.handshake(
                tunnel.cdn_ips[0] if tunnel.cdn_ips else tunnel.cdn_host,
                tunnel.cdn_port or 443,
                tunnel.cdn_front or tunnel.cdn_host,
                tunnel.cdn_host,
                tunnel.path or "/",
                timeout=10.0,
            )
            cdn_error = f"CDN path: {cdn_error}" if cdn_error else None
        else:
            cdn_reachable, cdn_latency, cdn_error = await cdn_probe(tunnel.cdn_host, tunnel.cdn_port or 443, tunnel.path or "/")

    tunnel.last_checked_at = datetime.now(timezone.utc)
    unreachable = [
        side
        for side, ok in (("Iran side", iran_reachable), ("foreign side", foreign_reachable), ("CDN path", cdn_reachable))
        if ok is False
    ]
    if unreachable:
        tunnel.status = TunnelStatus.error
        tunnel.last_error = cdn_error if unreachable == ["CDN path"] and cdn_error else f"{' and '.join(unreachable)} not reachable"
    elif iran_reachable and foreign_reachable:
        tunnel.status = TunnelStatus.connected
        tunnel.last_error = None
    else:
        # Nothing failed, but a side was skipped — "untested" is the honest
        # verdict, not "connected".
        tunnel.status = TunnelStatus.pending
        tunnel.last_error = None

    await db.commit()

    return TunnelTestResult(
        status=tunnel.status,
        iran_reachable=iran_reachable,
        iran_latency_ms=iran_latency,
        foreign_reachable=foreign_reachable,
        foreign_latency_ms=foreign_latency,
        cdn_reachable=cdn_reachable,
        cdn_latency_ms=cdn_latency,
        error=tunnel.last_error,
    )


# --- CDN quality (app/tunnels/cdn_scan.py) ---------------------------------

async def _cdn_run(tunnel: Tunnel, db: AsyncSession, kind: str, params: dict) -> dict:
    """Runs a CDN check from the tunnel's foreign server when that is a
    panel node (its agent has the same code), otherwise from the panel —
    and says which, since the edge that is best depends on where you are."""
    if not tunnel.cdn_host:
        raise HTTPException(status_code=400, detail="This tunnel doesn't go through a CDN")
    base = {"provider": tunnel.cdn_provider or "arvan", "host": tunnel.cdn_host, "path": tunnel.path or "/", "port": tunnel.cdn_port or 443}
    node = await db.get(Node, tunnel.foreign_node_id) if tunnel.foreign_node_id else None
    if node is not None:
        try:
            # verify=False: the node's certificate is self-signed (node_agent/tls.py).
            async with httpx.AsyncClient(timeout=120, verify=False) as client:
                resp = await client.post(
                    f"https://{node.address}:{node.port}/cdn/check",
                    json={"kind": kind, **base, **params},
                    headers={"X-Node-Api-Key": node.api_key},
                )
            if resp.status_code == 200:
                return {**resp.json(), "ran_on": "node", "ran_on_name": node.name}
        except httpx.HTTPError:
            pass  # an old or unreachable agent: measure from the panel instead
    if kind == "edges":
        out = await cdn_scan.scan_edges(base["provider"], base["host"], base["path"], base["port"], sni=params.get("sni"))
    elif kind == "fronts":
        out = await cdn_scan.scan_fronts(base["provider"], base["host"], base["path"], base["port"], edge=params.get("edge"))
    else:
        out = await cdn_scan.speed_test(params["addr"], base["port"], params["sni"], base["host"], base["path"], tunnel.token)
    return {**out, "ran_on": "panel", "ran_on_name": "panel"}


@router.post("/{tunnel_id}/cdn/edges", response_model=CdnEdgeScan)
async def cdn_edges(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    # Scan with the SNI the tunnel will use, so fronting and edge agree.
    return await _cdn_run(tunnel, db, "edges", {"sni": tunnel.cdn_front})


@router.post("/{tunnel_id}/cdn/fronts", response_model=CdnFrontScan)
async def cdn_fronts(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    return await _cdn_run(tunnel, db, "fronts", {"edge": (tunnel.cdn_ips or [None])[0]})


@router.post("/{tunnel_id}/cdn/speed", response_model=CdnSpeed)
async def cdn_speed(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    """Downloads through the CDN with exactly the saved edge and SNI."""
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    addr = (tunnel.cdn_ips or [tunnel.cdn_host])[0] if tunnel.cdn_host else ""
    return await _cdn_run(tunnel, db, "speed", {"addr": addr, "sni": tunnel.cdn_front or tunnel.cdn_host, "token": tunnel.token})

