import ipaddress

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.host import Host
from app.models.user import ProxyUser
from app.models.wireguard_peer import WireGuardPeer
from app.wireguard.keys import generate_wireguard_keypair


async def _allocate_address(host: Host, db: AsyncSession) -> str:
    subnet = host.core.wireguard_subnet if host.core else None
    network = ipaddress.ip_network(subnet, strict=False)
    result = await db.execute(select(WireGuardPeer.address).where(WireGuardPeer.host_id == host.id))
    taken = {address for (address,) in result.all()}

    hosts_iter = network.hosts()
    next(hosts_iter, None)  # the subnet's first usable address is reserved for the server itself
    for candidate in hosts_iter:
        address = str(candidate)
        if address not in taken:
            return address
    raise ValueError(f"WireGuard subnet {subnet} on host {host.id} has no free addresses left")


async def get_or_create_peer(host: Host, user: ProxyUser, db: AsyncSession) -> WireGuardPeer:
    """Lazily provisions a peer the first time a user's links are requested
    for this host, then always returns that same peer afterwards — the
    keypair and IP must stay stable, since the server-side peer block the
    admin already pasted in references them."""
    peer = await db.scalar(
        select(WireGuardPeer).where(WireGuardPeer.host_id == host.id, WireGuardPeer.user_id == user.id)
    )
    if peer is not None:
        return peer

    address = await _allocate_address(host, db)
    keys = generate_wireguard_keypair()
    peer = WireGuardPeer(
        host_id=host.id,
        user_id=user.id,
        private_key=keys["private_key"],
        public_key=keys["public_key"],
        address=address,
    )
    db.add(peer)
    await db.commit()
    await db.refresh(peer)
    return peer
