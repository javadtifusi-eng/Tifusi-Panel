from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.host import Host
from app.models.node import Node, NodeStatus
from app.models.user import ProxyUser
from app.schemas.node import NodeCreate, NodeList, NodeResponse, NodeSyncResult
from app.xray_config.builder import build_xray_config

router = APIRouter(prefix="/api/nodes", tags=["nodes"], dependencies=[Depends(get_current_admin)])


@router.get("", response_model=NodeList)
async def list_nodes(db: AsyncSession = Depends(get_db)) -> NodeList:
    total = await db.scalar(select(func.count()).select_from(Node))
    result = await db.execute(select(Node).order_by(Node.id.desc()))
    return NodeList(total=total or 0, nodes=list(result.scalars().all()))


@router.post("", response_model=NodeResponse, status_code=201)
async def create_node(payload: NodeCreate, db: AsyncSession = Depends(get_db)) -> Node:
    node = Node(name=payload.name, address=payload.address, port=payload.port)
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return node


async def _get_node_or_404(node_id: int, db: AsyncSession) -> Node:
    node = await db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)) -> Node:
    return await _get_node_or_404(node_id, db)


@router.delete("/{node_id}", status_code=204)
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)) -> None:
    node = await _get_node_or_404(node_id, db)
    await db.delete(node)
    await db.commit()


@router.post("/{node_id}/sync", response_model=NodeSyncResult)
async def sync_node(node_id: int, db: AsyncSession = Depends(get_db)) -> NodeSyncResult:
    node = await _get_node_or_404(node_id, db)

    hosts = list((await db.execute(select(Host))).scalars().all())
    users = list((await db.execute(select(ProxyUser))).scalars().all())
    config = build_xray_config(hosts, users)

    base_url = f"http://{node.address}:{node.port}"
    headers = {"X-Node-Api-Key": node.api_key}

    health: dict | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(f"{base_url}/config", json=config, headers=headers)
            resp.raise_for_status()
            health_resp = await client.get(f"{base_url}/health", headers=headers)
            health_resp.raise_for_status()
            health = health_resp.json()
    except httpx.HTTPStatusError as exc:
        error = f"{exc.response.status_code}: {exc.response.text[:200]}"
    except httpx.HTTPError as exc:
        error = str(exc)[:500]

    if health is None:
        node.status = NodeStatus.error
        node.last_error = error
    else:
        node.status = NodeStatus.connected if health.get("running") else NodeStatus.error
        node.xray_version = health.get("xray_version")
        node.last_error = None if health.get("running") else "xray reported not running"
        node.last_synced_at = datetime.now(timezone.utc)

    await db.commit()
    return NodeSyncResult(
        status=node.status,
        xray_version=node.xray_version,
        error=node.last_error,
        inbound_count=len(config["inbounds"]),
    )
