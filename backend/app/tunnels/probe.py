"""A lightweight reachability+latency check for one side of a Tunnel.

This is deliberately NOT a real tunnel health check — backend/tunnel_agent
runs as its own unmanaged binary the panel never talks to as an agent
(unlike a Node), so there is no status API to ask. A plain TCP connect
is the most any side can promise before the tunnel is actually installed:
it tells the admin "this address is up and something is listening on
this port", nothing about whether the tunnel relay itself is healthy.
"""

import asyncio
import time


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
