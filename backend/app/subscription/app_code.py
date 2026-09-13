"""A short per-user code for the Tifusi VPN Android app.

The subscription link can't always be delivered (no SMS or messenger), so an
admin reads this code out and the user types it into the app. It is derived
from the user's secret instead of being stored, so no migration is needed and
resetting the secret retires the code along with the old link.
"""

import hashlib

from app.models.user import ProxyUser

# No 0/O or 1/I/L, and lookups ignore case: the code is read aloud and typed.
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_RANDOM_LENGTH = 8


def app_code_for(user: ProxyUser) -> str:
    digest = hashlib.sha256(f"tifusi-app-code:{user.secret}".encode()).digest()
    suffix = "".join(_ALPHABET[b % len(_ALPHABET)] for b in digest[:_RANDOM_LENGTH])
    return f"{user.username}{suffix}"
