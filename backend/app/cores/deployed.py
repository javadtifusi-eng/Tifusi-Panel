"""Which hosts are actually served right now, and default hosts for cores.

A host stands on a core (directly, or through an Xray inbound). A core only
serves anything once a node runs it, so a host whose core sits on no node
would hand users a link that can't connect. Filtering on that makes the
subscription follow the nodes: put a core on a node and its hosts show up on
the next subscription update, take it off and they go away again.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import Core, CoreType
from app.models.host import Host, HostProtocol
from app.models.node import Node

_CORE_PROTOCOL = {
    CoreType.ikev2: HostProtocol.ikev2,
    CoreType.l2tp: HostProtocol.l2tp,
    CoreType.hysteria2: HostProtocol.hysteria2,
    CoreType.wireguard: HostProtocol.wireguard,
}


async def deployed_core_ids(db: AsyncSession) -> set[int]:
    ids: set[int] = set()
    for node in (await db.execute(select(Node))).scalars():
        for core_id in (node.core_id, node.ipsec_core_id, node.hysteria_core_id, node.wireguard_core_id):
            if core_id is not None:
                ids.add(core_id)
    return ids


def is_deployed(host: Host, core_ids: set[int]) -> bool:
    if host.core_id is not None:
        return host.core_id in core_ids
    if host.inbound is not None:
        return host.inbound.core_id in core_ids
    return True  # a host tied to nothing: nothing to check it against


async def live_hosts(db: AsyncSession) -> list[Host]:
    core_ids = await deployed_core_ids(db)
    return [h for h in (await db.execute(select(Host))).scalars().all() if is_deployed(h, core_ids)]


async def ensure_core_hosts(node: Node, db: AsyncSession) -> None:
    """Gives each non-Xray core on this node a host if it has none, so a new
    core reaches users without a separate trip to the Hosts page. The address
    is the node's own (IKEv2 uses its certificate name); an admin serving it
    through a tunnel edits it to the Iran address like any other host."""
    for core_id in (node.ipsec_core_id, node.hysteria_core_id, node.wireguard_core_id):
        if core_id is None:
            continue
        core = await db.get(Core, core_id)
        protocol = _CORE_PROTOCOL.get(core.core_type) if core is not None else None
        if protocol is None:
            continue
        if await db.scalar(select(Host.id).where(Host.core_id == core.id).limit(1)) is not None:
            continue
        address = node.address
        if core.core_type == CoreType.ikev2 and core.ikev2_remote_id:
            address = core.ikev2_remote_id
        db.add(Host(remark=core.name, address=address, protocol=protocol, core_id=core.id))
