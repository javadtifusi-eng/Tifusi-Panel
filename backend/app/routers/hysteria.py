"""Hysteria2 asks the panel who a password belongs to.

Hysteria2 is a separate program from Xray, so its users are not the clients
Xray's config carries — it authenticates on its own. Writing every user's
password into its config would mean rewriting that file and restarting the
server on every user change, dropping everyone's connection each time a bot
sells a subscription. Instead it is pointed at this endpoint: on each
connection it asks, the panel looks the password up among its users, and
answers with who it is or refuses.

The password is the user's own subscription secret, so nothing new has to be
generated or stored, and expiry, status and protocol access are decided here
by exactly the same rules as every other protocol.

Reached over the loopback from the same host, never published: the endpoint
carries a token derived from the panel's own secret key — stable across
restarts, nothing to store or migrate — and still refuses a caller that
isn't on this machine.
"""

import hashlib
import hmac
import ipaddress
import secrets

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.groups.access import allows_protocol
from app.models.host import HostProtocol
from app.models.user import ProxyUser, UserStatus
from app.subscription.lookup import client_ip

router = APIRouter(prefix="/api/hysteria", tags=["hysteria"])


def auth_token() -> str:
    """What Hysteria2 sends back to prove the caller is our own server."""
    return hmac.new(settings.secret_key.encode(), b"hysteria-auth", hashlib.sha256).hexdigest()[:32]


def _local(request: Request) -> bool:
    """Hysteria2 runs on the node itself and reaches the panel over the
    loopback, which Docker's port proxy turns into its gateway address — so
    any private address counts, and a public one never does."""
    try:
        return not ipaddress.ip_address(client_ip(request)).is_global
    except ValueError:
        return False


@router.post("/auth/{token}")
async def authenticate(token: str, request: Request, body: dict = Body(...), db: AsyncSession = Depends(get_db)) -> dict:
    if not _local(request) or not secrets.compare_digest(token, auth_token()):
        raise HTTPException(status_code=404, detail="Not found")

    password = str(body.get("auth") or "").strip()
    user = await db.scalar(select(ProxyUser).where(ProxyUser.secret == password)) if password else None
    if user is None or user.status is not UserStatus.active or not allows_protocol(user, HostProtocol.hysteria2):
        # Hysteria2 reads `ok` and nothing else on a refusal; the reason stays
        # here rather than telling whoever is knocking which part they got right.
        return {"ok": False}
    return {"ok": True, "id": user.username}
