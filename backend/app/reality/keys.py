import base64
import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey


def _b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def generate_reality_keypair() -> dict[str, str]:
    """Generate an X25519 keypair in the same raw/base64url form Xray's
    own `xray x25519` command produces, plus a short id for the REALITY
    handshake."""
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
        "private_key": _b64url_nopad(private_bytes),
        "public_key": _b64url_nopad(public_bytes),
        "short_id": secrets.token_hex(4),
    }
