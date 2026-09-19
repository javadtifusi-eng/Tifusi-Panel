"""A lightweight reachability+latency check for one side of a Tunnel.

This is deliberately NOT a real tunnel health check — backend/tunnel_agent
runs as its own unmanaged binary the panel never talks to as an agent
(unlike a Node), so there is no status API to ask. A plain TCP connect
is the most any side can promise before the tunnel is actually installed:
it tells the admin "this address is up and something is listening on
this port", nothing about whether the tunnel relay itself is healthy.
"""

import asyncio
import base64
import os
import ssl
import time

from app.models.tunnel import TunnelTransport

_SAMPLES = 3


async def tcp_probe(host: str, port: int, timeout: float = 5.0) -> tuple[bool, float | None]:
    start = time.monotonic()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        elapsed_ms = (time.monotonic() - start) * 1000
    except Exception:
        return False, None

    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass
    return True, elapsed_ms


async def ping_probe(host: str, port: int, timeout: float = 3.0) -> tuple[bool, float | None]:
    """Like tcp_probe, but samples a few connects and keeps the best RTT -
    one slow/lost sample (a retransmit, a busy accept queue) shouldn't
    single-handedly tank a "which transport is best" recommendation the
    way it's fine to for a one-shot up/down health check.
    """
    best: float | None = None
    reachable = False
    for _ in range(_SAMPLES):
        ok, latency = await tcp_probe(host, port, timeout=timeout)
        if ok:
            reachable = True
            if best is None or (latency is not None and latency < best):
                best = latency
    return reachable, best


# Two fixed orderings of the same transport set, front-loaded by what each
# situation actually rewards. Neither ordering claims to know whether a
# transport specifically evades DPI on THIS link — nothing reachable from
# the panel can promise that, since the panel isn't inside Iran's network.
# What it can honestly measure is raw latency to both ends, and that's a
# reasonable proxy for "is a lighter-weight transport worth it" vs
# "is this link slow/far enough that CDN-friendly wss is worth the overhead".
_FAST_LINK_ORDER: list[TunnelTransport] = [
    TunnelTransport.tcp,
    TunnelTransport.tcpmux,
    TunnelTransport.tls,
    TunnelTransport.ws,
    TunnelTransport.wsmux,
    TunnelTransport.wss,
    TunnelTransport.wssmux,
    TunnelTransport.udp,
]
_SLOW_LINK_ORDER: list[TunnelTransport] = [
    TunnelTransport.wss,
    TunnelTransport.wssmux,
    TunnelTransport.ws,
    TunnelTransport.wsmux,
    TunnelTransport.tls,
    TunnelTransport.tcpmux,
    TunnelTransport.tcp,
    TunnelTransport.udp,
]

# Above this combined (Iran + foreign) latency, in ms, the link is
# considered slow/far enough that a CDN-friendly transport is favored.
_SLOW_LINK_THRESHOLD_MS = 150.0


async def recommend_transports(
    iran_host: str, iran_port: int, foreign_host: str, foreign_port: int
) -> tuple[bool, float | None, bool, float | None, str, list[TunnelTransport]]:
    iran_reachable, iran_latency = await ping_probe(iran_host, iran_port)
    foreign_reachable, foreign_latency = await ping_probe(foreign_host, foreign_port)

    combined = (iran_latency or 0.0) + (foreign_latency or 0.0)
    slow_or_unreachable = (
        not iran_reachable or not foreign_reachable or combined > _SLOW_LINK_THRESHOLD_MS
    )
    link = "slow" if slow_or_unreachable else "fast"
    order = _SLOW_LINK_ORDER if slow_or_unreachable else _FAST_LINK_ORDER
    return iran_reachable, iran_latency, foreign_reachable, foreign_latency, link, order


async def cdn_probe(host: str, port: int, path: str, timeout: float = 10.0) -> tuple[bool, float | None, str | None]:
    """Sends a WebSocket upgrade to the CDN name, the way the foreign side
    does, and reports whether the relay answered it. A CDN only returns
    101 Switching Protocols after the relay behind it has; anything else
    (the CDN's own error page, a TLS failure, a timeout) means the CDN
    path is broken, even if the relay itself is up."""
    start = time.monotonic()
    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ssl.create_default_context(), server_hostname=host), timeout=timeout
        )
        key = base64.b64encode(os.urandom(16)).decode()
        writer.write(
            (
                f"GET {path or '/'} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: Mozilla/5.0\r\n"
                f"Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n"
                f"Sec-WebSocket-Key: {key}\r\n\r\n"
            ).encode()
        )
        await writer.drain()
        status = (await asyncio.wait_for(reader.readline(), timeout=timeout)).decode(errors="replace").strip()
        elapsed = (time.monotonic() - start) * 1000
        if " 101 " in f"{status} ":
            return True, elapsed, None
        return False, None, f"CDN answered: {status[:80] or 'nothing'}"
    except ssl.SSLError as exc:
        return False, None, f"TLS to the CDN failed: {exc.reason or exc.__class__.__name__}"
    except Exception as exc:  # noqa: BLE001
        return False, None, f"CDN not reachable: {exc.__class__.__name__}"
    finally:
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
