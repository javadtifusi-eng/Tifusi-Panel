"""WireGuard keys and addresses for the WireGuard core.

Nothing per user is stored. Each user's key pair is derived from the core's
own private key and the user's secret, so it is stable across syncs and
restarts, different on every core, and cannot be worked out by anyone who
does not hold the server key. The tunnel address is derived from the user's
id the same way, so two users can never collide and nothing has to be
allocated or remembered.
"""

import base64
import hashlib
import hmac

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

# 10.66.0.0/16: 10.66.0.1 is the server, users start at 10.66.0.2.
SUBNET_PREFIX = "10.66"
SERVER_ADDRESS = f"{SUBNET_PREFIX}.0.1"
DEFAULT_MTU = 1280
DEFAULT_PORT = 4500


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _clamp(raw: bytes) -> bytes:
    key = bytearray(raw)
    key[0] &= 248
    key[31] &= 127
    key[31] |= 64
    return bytes(key)


def generate_private_key() -> str:
    key = X25519PrivateKey.generate()
    return _b64(key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()))


def public_key(private_key_b64: str) -> str:
    key = X25519PrivateKey.from_private_bytes(base64.b64decode(private_key_b64))
    return _b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))


def user_private_key(server_private_key_b64: str, user_secret: str) -> str:
    digest = hmac.new(base64.b64decode(server_private_key_b64), user_secret.encode(), hashlib.sha256).digest()
    return _b64(_clamp(digest))


def user_address(user_id: int) -> str:
    """10.66.0.2 onwards; .0, .1 and .255 of every block are skipped."""
    n = user_id - 1
    return f"{SUBNET_PREFIX}.{n // 253}.{n % 253 + 2}"
