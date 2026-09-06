from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cores.resolve import resolve_ipsec_core_id, resolve_xray_core_id
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.node import Node
from app.nodes.sync import sync_node
from app.schemas.node import NodeCreate, NodeList, NodeResponse, NodeSyncResult, NodeUpdate

router = APIRouter(prefix="/api/nodes", tags=["nodes"], dependencies=[Depends(get_current_admin)])


@router.get("", response_model=NodeList)
async def list_nodes(db: AsyncSession = Depends(get_db)) -> NodeList:
    total = await db.scalar(select(func.count()).select_from(Node))
    result = await db.execute(select(Node).order_by(Node.id.desc()))
    return NodeList(total=total or 0, nodes=list(result.scalars().all()))


@router.post("", response_model=NodeResponse, status_code=201)
async def create_node(payload: NodeCreate, db: AsyncSession = Depends(get_db)) -> Node:
    node = Node(name=payload.name, address=payload.address, port=payload.port)
    node.core_id = await resolve_xray_core_id(payload.core_id, db)
    node.ipsec_core_id = await resolve_ipsec_core_id(payload.ipsec_core_id, db)
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


@router.put("/{node_id}", response_model=NodeResponse)
async def update_node(node_id: int, payload: NodeUpdate, db: AsyncSession = Depends(get_db)) -> Node:
    node = await _get_node_or_404(node_id, db)

    for field, value in payload.model_dump(
        exclude_unset=True, exclude={"core_id", "ipsec_core_id"}
    ).items():
        setattr(node, field, value)

    if "core_id" in payload.model_fields_set:
        node.core_id = await resolve_xray_core_id(payload.core_id, db)
    if "ipsec_core_id" in payload.model_fields_set:
        node.ipsec_core_id = await resolve_ipsec_core_id(payload.ipsec_core_id, db)

    db.add(node)
    await db.commit()
    await db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=204)
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)) -> None:
    node = await _get_node_or_404(node_id, db)
    await db.delete(node)
    await db.commit()


@router.post("/{node_id}/sync", response_model=NodeSyncResult)
async def trigger_sync(node_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    node = await _get_node_or_404(node_id, db)
    return await sync_node(node, db)
