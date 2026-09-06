from app.models.host import Host
from app.models.wireguard_peer import WireGuardPeer

_DNS = "1.1.1.1"


def build_client_config(peer: WireGuardPeer, host: Host) -> str:
    """The full `.conf` a WireGuard app (desktop or mobile) imports directly."""
    return (
        "[Interface]\n"
        f"PrivateKey = {peer.private_key}\n"
        f"Address = {peer.address}/32\n"
        f"DNS = {_DNS}\n"
        "\n"
        "[Peer]\n"
        f"PublicKey = {host.wireguard_public_key}\n"
        f"Endpoint = {host.address}:{host.effective_port}\n"
        "AllowedIPs = 0.0.0.0/0, ::/0\n"
        "PersistentKeepalive = 25\n"
    )


def build_server_peer_block(peer: WireGuardPeer) -> str:
    """What the admin pastes into this host's own wg0.conf to actually wire
    the peer in. Tifusi doesn't touch the WireGuard kernel interface on the
    node (that needs NET_ADMIN there), so this hand-off stays manual — the
    same honestly-scoped gap as the node agent not managing wg-quick."""
    return f"[Peer]\nPublicKey = {peer.public_key}\nAllowedIPs = {peer.address}/32\n"
