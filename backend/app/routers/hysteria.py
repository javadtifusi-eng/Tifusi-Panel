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

Two kinds of caller are allowed, and nothing else. A Hysteria2 server on the
panel's own machine reaches this over the loopback. A server on a *remote* node
cannot: it would arrive from a public address, and it has no panel credential to
present. So there the node agent answers on its own loopback instead and
forwards the question here with the node API key it already holds — which keeps
every panel secret off the node and means a stolen node reveals nothing.

Either way the endpoint carries a token derived from the panel's own secret key,
stable across restarts with nothing to store or migrate.
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
from app.models.node import Node
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


async def _from_known_node(request: Request, db: AsyncSession) -> bool:
    """A node agent forwarding on behalf of the Hysteria2 server it runs. The
    key is compared in constant time against every node's, because which node
    asked is not interesting here — only that some node did."""
    presented = request.headers.get("X-Node-Api-Key")
    if not presented:
        return False
    keys = list((await db.execute(select(Node.api_key))).scalars().all())
    return any(secrets.compare_digest(presented, k) for k in keys)


@router.post("/auth/{token}")
async def authenticate(token: str, request: Request, body: dict = Body(...), db: AsyncSession = Depends(get_db)) -> dict:
    # Two separate credentials, not one check with an OR in it. A caller on this
    # machine proves itself with the token in the path, which is all a loopback
    # caller can carry. A node agent proves itself with its own API key, and then
    # the token is not required — it never had a way to learn it, and giving it
    # one would put a value derived from the panel's secret key on every node.
    if not (_local(request) and secrets.compare_digest(token, auth_token())):
        if not await _from_known_node(request, db):
            raise HTTPException(status_code=404, detail="Not found")

    password = str(body.get("auth") or "").strip()
    user = await db.scalar(select(ProxyUser).where(ProxyUser.secret == password)) if password else None
    if user is None or user.status is not UserStatus.active or not allows_protocol(user, HostProtocol.hysteria2):
        # Hysteria2 reads `ok` and nothing else on a refusal; the reason stays
        # here rather than telling whoever is knocking which part they got right.
        return {"ok": False}
    return {"ok": True, "id": user.username}
