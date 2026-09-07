from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.node import Node
from app.models.tunnel import Tunnel, TunnelStatus
from app.schemas.tunnel import (
    TunnelConfig,
    TunnelCreate,
    TunnelList,
    TunnelResponse,
    TunnelTestResult,
    TunnelUpdate,
)
from app.tunnels.config import build_foreign_config, build_iran_config
from app.tunnels.probe import tcp_probe

router = APIRouter(prefix="/api/tunnels", tags=["tunnels"], dependencies=[Depends(get_current_admin)])


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
        transport=payload.transport,
        sni=payload.sni,
        domain=payload.domain,
        path=payload.path,
        connection_count=payload.connection_count,
        forwards=[f.model_dump() for f in payload.forwards],
    )
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

    _validate_foreign(tunnel.foreign_node_id, tunnel.foreign_address)

    db.add(tunnel)
    await db.commit()
    await db.refresh(tunnel)
    return tunnel


@router.delete("/{tunnel_id}", status_code=204)
async def delete_tunnel(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> None:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    await db.delete(tunnel)
    await db.commit()


@router.get("/{tunnel_id}/config", response_model=TunnelConfig)
async def get_tunnel_config(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> TunnelConfig:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)
    return TunnelConfig(
        iran_config=build_iran_config(tunnel),
        foreign_config=build_foreign_config(tunnel),
        install_command=(
            'bash <(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/'
            'Tifusi-Panel/main/backend/tunnel_agent/install.sh)'
        ),
    )


@router.post("/{tunnel_id}/test", response_model=TunnelTestResult)
async def test_tunnel(tunnel_id: int, db: AsyncSession = Depends(get_db)) -> TunnelTestResult:
    tunnel = await _get_tunnel_or_404(tunnel_id, db)

    iran_reachable, iran_latency = await tcp_probe(tunnel.iran_address, tunnel.iran_port)

    if tunnel.foreign_node_id is not None:
        node = await db.get(Node, tunnel.foreign_node_id)
        # A Node's own agent port is always meant to be open, so it's a far
        # more meaningful probe target than guessing at a port on a bare
        # address (see probe.py's own note on what this check can and
        # can't promise).
        foreign_host, foreign_port = (node.address, node.port) if node else (tunnel.foreign_address, 22)
    else:
        foreign_host, foreign_port = tunnel.foreign_address, 22

    foreign_reachable, foreign_latency = (
        await tcp_probe(foreign_host, foreign_port) if foreign_host else (False, None)
    )

    tunnel.last_checked_at = datetime.now(timezone.utc)
    if iran_reachable and foreign_reachable:
        tunnel.status = TunnelStatus.connected
        tunnel.last_error = None
    else:
        tunnel.status = TunnelStatus.error
        missing = []
        if not iran_reachable:
            missing.append("Iran side")
        if not foreign_reachable:
            missing.append("foreign side")
        tunnel.last_error = f"{' and '.join(missing)} not reachable"

    await db.commit()

    return TunnelTestResult(
        status=tunnel.status,
        iran_reachable=iran_reachable,
        iran_latency_ms=iran_latency,
        foreign_reachable=foreign_reachable,
        foreign_latency_ms=foreign_latency,
        error=tunnel.last_error,
    )
