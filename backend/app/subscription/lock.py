"""Config lock: subscriptions that only the Tifusi VPN app can use.

Three separate switches (their own config_lock, else the panel's):
- app: app.json carries the share links sealed with AES-256-GCM instead of in
  the clear; the app opens them in memory and shows only server names;
- other: every other client (v2rayNG, V2Box, Clash, sing-box…) gets a placeholder
  config that points nowhere and whose name tells the user to install the
  app;
- page: the subscription web page hides links and QR codes.

The key is derived from the credential the app fetched with (the
subscription secret or the app code), so it is never sent alongside the
data. This keeps server details out of sight of ordinary users; it is not
protection against someone who reverse-engineers the app, and the SNI still
crosses the network in the clear inside every TLS ClientHello.
"""

import base64
import hashlib
import json
import os
import urllib.parse

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.models.setting import PanelSetting
from app.models.user import ProxyUser

PLACEHOLDER_NAMES = (
    "🔒 برای اتصال، اپ Tifusi VPN را نصب کن",
    "🔒 Install the Tifusi VPN app to connect",
)


def lock_parts(user: ProxyUser, settings_row: PanelSetting | None) -> tuple[bool, bool, bool]:
    """(app, other clients, subscription page). A user's own config_lock
    turns all three on or off; otherwise each follows the panel's switch."""
    if user.config_lock is not None:
        return (user.config_lock,) * 3
    if settings_row is None:
        return (False, False, False)
    return (settings_row.lock_app, settings_row.lock_other, settings_row.lock_page)


def placeholder_links() -> list[str]:
    """Share links that import fine anywhere and connect nowhere."""
    return [
        "vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#"
        + urllib.parse.quote(name)
        for name in PLACEHOLDER_NAMES
    ]


def _key(credential: str) -> bytes:
    return hashlib.sha256(b"tifusi-config-lock/v1:" + credential.encode()).digest()


def seal(payload: dict, credential: str) -> str:
    """base64(nonce(12) || ciphertext || tag(16)), AES-256-GCM."""
    nonce = os.urandom(12)
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    return base64.b64encode(nonce + AESGCM(_key(credential)).encrypt(nonce, data, None)).decode()


def unseal(blob: str, credential: str) -> dict:
    raw = base64.b64decode(blob)
    return json.loads(AESGCM(_key(credential)).decrypt(raw[:12], raw[12:], None))
