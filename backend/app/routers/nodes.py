from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cores.deployed import ensure_core_hosts
from app.cores.resolve import (
    resolve_hysteria_core_id,
    resolve_ipsec_core_id,
    resolve_wireguard_core_id,
    resolve_xray_core_id,
)
from app.database import async_session, get_db
from app.dependencies import require_permission
from app.models.node import Node
from app.models.tunnel import Tunnel
from app.nodes.sync import sync_node
from app.schemas.node import NodeCreate, NodeList, NodeResponse, NodeSyncResult, NodeUpdate

router = APIRouter(prefix="/api/nodes", tags=["nodes"], dependencies=[Depends(require_permission("nodes"))])


@router.get("", response_model=NodeList)
async def list_nodes(db: AsyncSession = Depends(get_db)) -> NodeList:
    total = await db.scalar(select(func.count()).select_from(Node))
    result = await db.execute(select(Node).order_by(Node.id.desc()))
    return NodeList(total=total or 0, nodes=list(result.scalars().all()))


@router.post("", response_model=NodeResponse, status_code=201)
async def create_node(
    payload: NodeCreate, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)
) -> Node:
    node = Node(
        name=payload.name,
        address=payload.address,
        port=payload.port,
        l2tp_egress_vless=payload.l2tp_egress_vless,
    )
    node.core_id = await resolve_xray_core_id(payload.core_id, db)
    node.ipsec_core_id = await resolve_ipsec_core_id(payload.ipsec_core_id, db)
    node.hysteria_core_id = await resolve_hysteria_core_id(payload.hysteria_core_id, db)
    node.wireguard_core_id = await resolve_wireguard_core_id(payload.wireguard_core_id, db)
    db.add(node)
    await db.flush()
    await ensure_core_hosts(node, db)
    await db.commit()
    await db.refresh(node)
    background_tasks.add_task(_sync_in_background, node.id)
    return node


async def _sync_in_background(node_id: int) -> None:
    """Pushes a node's new core assignment right away instead of leaving the
    old services running until someone clicks sync. Own session: the
    request's is closed by the time background tasks run."""
    async with async_session() as db:
        node = await db.get(Node, node_id)
        if node is not None:
            try:
                await sync_node(node, db)
            except Exception:
                pass


async def _get_node_or_404(node_id: int, db: AsyncSession) -> Node:
    node = await db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)) -> Node:
    return await _get_node_or_404(node_id, db)


@router.put("/{node_id}", response_model=NodeResponse)
async def update_node(
    node_id: int, payload: NodeUpdate, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)
) -> Node:
    node = await _get_node_or_404(node_id, db)

    for field, value in payload.model_dump(
        exclude_unset=True, exclude={"core_id", "ipsec_core_id", "hysteria_core_id", "wireguard_core_id"}
    ).items():
        setattr(node, field, value)

    if "core_id" in payload.model_fields_set:
        node.core_id = await resolve_xray_core_id(payload.core_id, db)
    if "ipsec_core_id" in payload.model_fields_set:
        node.ipsec_core_id = await resolve_ipsec_core_id(payload.ipsec_core_id, db)
    if "hysteria_core_id" in payload.model_fields_set:
        node.hysteria_core_id = await resolve_hysteria_core_id(payload.hysteria_core_id, db)
    if "wireguard_core_id" in payload.model_fields_set:
        node.wireguard_core_id = await resolve_wireguard_core_id(payload.wireguard_core_id, db)

    slots = {"core_id", "ipsec_core_id", "hysteria_core_id", "wireguard_core_id"}
    db.add(node)
    await ensure_core_hosts(node, db)
    await db.commit()
    await db.refresh(node)
    if slots & payload.model_fields_set:
        background_tasks.add_task(_sync_in_background, node.id)
    return node


@router.delete("/{node_id}", status_code=204)
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)) -> None:
    node = await _get_node_or_404(node_id, db)

    # SQLite isn't enforcing the tunnels.foreign_node_id foreign key, so
    # deleting the node here would leave those tunnels pointing at an id
    # that no longer resolves: unlabelled in the UI and permanently failing
    # their check, with nothing saying why. Make the admin repoint them.
    result = await db.execute(select(Tunnel.name).where(Tunnel.foreign_node_id == node_id))
    used_by = list(result.scalars().all())
    if used_by:
        raise HTTPException(
            status_code=409,
            detail=f"Node is still the foreign side of these tunnels: {', '.join(used_by)}",
        )

    await db.delete(node)
    await db.commit()


@router.post("/{node_id}/sync", response_model=NodeSyncResult)
async def trigger_sync(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _get_node_or_404(node_id, db)
    return await sync_node(node, db)
