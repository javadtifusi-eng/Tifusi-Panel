import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey


def generate_wireguard_keypair() -> dict[str, str]:
    """Same Curve25519 math as REALITY, different encoding: WireGuard's own
    tools (`wg genkey`/`wg pubkey`) emit standard base64 (with padding), not
    the url-safe/no-pad form Xray's REALITY keys use — mixing the two up
    produces a key that looks right and doesn't work."""
    private_key = X25519PrivateKey.generate()
    public_key = private_key.public_key()

    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )

    return {
        "private_key": base64.b64encode(private_bytes).decode(),
        "public_key": base64.b64encode(public_bytes).decode(),
    }
