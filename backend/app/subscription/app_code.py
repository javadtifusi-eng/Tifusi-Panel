"""A short per-user code for the Tifusi VPN Android app.

The subscription link can't always be delivered (no SMS or messenger), so an
admin reads this code out and the user types it into the app. It is derived
from the user's secret instead of being stored, so no migration is needed and
resetting the secret retires the code along with the old link.
"""

import base64
import binascii
import hashlib
import re
from urllib.parse import urlsplit

from app.models.user import ProxyUser

# No 0/O or 1/I/L, and lookups ignore case: the code is read aloud and typed.
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_RANDOM_LENGTH = 8


def app_code_for(user: ProxyUser) -> str:
    digest = hashlib.sha256(f"tifusi-app-code:{user.secret}".encode()).digest()
    suffix = "".join(_ALPHABET[b % len(_ALPHABET)] for b in digest[:_RANDOM_LENGTH])
    return f"{user.username}{suffix}"




_HOST = re.compile(r"^[a-z0-9.-]+\.[a-z0-9-]+(:\d{1,5})?$")


def app_code_with_host(user: ProxyUser, base: str) -> str:
    """What the panel shows and copies: the code, a dash, and the subscription host
    in base32. The code is meant to travel over SMS, where a readable domain or a
    link risks being filtered, and it has to work like the QR code does: the app
    takes the address from what it is given, so it carries no panel address of its
    own and a change of domain never needs a new build."""
    host = urlsplit(base).netloc.lower()
    encoded = base64.b32encode(host.encode()).decode().rstrip("=")
    return f"{app_code_for(user)}-{encoded}"


def strip_embedded_host(value: str) -> str:
    """The bare code out of what the panel handed out, or the value unchanged when
    it has no host on it (older codes, and usernames that contain a dash)."""
    head, dash, tail = value.rpartition("-")
    if not dash or not head or not tail:
        return value
    padded = tail.upper() + "=" * (-len(tail) % 8)
    try:
        host = base64.b32decode(padded).decode("ascii")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return value
    return head if _HOST.match(host) else value
