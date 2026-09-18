"""Is a name (or the node's own address) reachable from inside Iran?

The panel and the nodes both sit outside Iran, so neither can see Iranian
filtering. check-host.net runs probe servers inside Iran (Tehran, Isfahan,
Shiraz, Qom); asking a few of them to open https://NAME tells us whether
the name is filtered there, and a TCP check against the node's address
tells us whether the node itself is reachable. Only the name or the node
address is sent — never anything about users.

Results are cached: the same name is checked at most once per _TTL.
"""

import asyncio
import time

import httpx

CHECK_HOST = "https://check-host.net"
# One per city, so a single datacenter's own routing problem doesn't read
# as a nationwide block.
IRAN_NODES = ("ir1.node.check-host.net", "ir2.node.check-host.net", "ir3.node.check-host.net", "ir6.node.check-host.net")
_TTL = 20 * 60
_POLL_FOR = 25.0

_cache: dict[str, tuple[float, dict]] = {}
_inflight: dict[str, asyncio.Task] = {}
_sem = asyncio.Semaphore(3)


def _headers() -> dict:
    return {"Accept": "application/json"}


async def _run(kind: str, target: str) -> dict:
    params = [("host", target)] + [("node", n) for n in IRAN_NODES]
    async with _sem, httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
        resp = await client.get(f"{CHECK_HOST}/check-{kind}", params=params)
        resp.raise_for_status()
        request_id = resp.json().get("request_id")
        if not request_id:
            raise RuntimeError("check-host.net refused the check")
        deadline = time.monotonic() + _POLL_FOR
        data: dict = {}
        while time.monotonic() < deadline:
            await asyncio.sleep(2.5)
            data = (await client.get(f"{CHECK_HOST}/check-result/{request_id}")).json()
            if data and all(v is not None for v in data.values()):
                break

    per_city = []
    for node in IRAN_NODES:
        raw = data.get(node)
        entry: dict = {"node": node.split(".")[0], "ok": None, "ms": None, "error": None}
        if raw is None:
            per_city.append(entry)
            continue
        first = raw[0] if isinstance(raw, list) and raw else raw
        if kind == "http" and isinstance(first, list) and first:
            entry["ok"] = first[0] == 1
            entry["ms"] = round(first[1] * 1000) if len(first) > 1 and isinstance(first[1], (int, float)) else None
            if not entry["ok"]:
                entry["error"] = str(first[2]) if len(first) > 2 else None
        elif kind == "tcp" and isinstance(first, dict):
            entry["ok"] = "time" in first
            entry["ms"] = round(first["time"] * 1000) if "time" in first else None
            entry["error"] = first.get("error")
        per_city.append(entry)

    answered = [c for c in per_city if c["ok"] is not None]
    ok = sum(1 for c in answered if c["ok"])
    if not answered:
        verdict = "unknown"
    elif ok == len(answered):
        verdict = "open"
    elif ok == 0:
        verdict = "blocked"
    else:
        verdict = "partial"
    return {"verdict": verdict, "ok": ok, "checked": len(answered), "cities": per_city, "checked_at": time.time()}


async def _cached(kind: str, target: str) -> dict:
    key = f"{kind}:{target}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    task = _inflight.get(key)
    if task is None:
        task = _inflight[key] = asyncio.create_task(_run(kind, target))
    try:
        result = await task
    except Exception as exc:  # noqa: BLE001 - an outside service being down is reported, not raised
        result = {"verdict": "unknown", "ok": 0, "checked": 0, "cities": [], "error": str(exc)[:200], "checked_at": time.time()}
    finally:
        _inflight.pop(key, None)
    if result["verdict"] != "unknown":
        _cache[key] = (time.time(), result)
    return result


def cached_only(kind: str, target: str) -> dict | None:
    hit = _cache.get(f"{kind}:{target}")
    return hit[1] if hit and time.time() - hit[0] < _TTL else None


def pending(kind: str, target: str) -> bool:
    return f"{kind}:{target}" in _inflight


async def sni(name: str) -> dict:
    return await _cached("http", f"https://{name}")


async def address(host: str, port: int) -> dict:
    return await _cached("tcp", f"{host}:{port}")


def start_sni(name: str) -> None:
    """Fire-and-forget: the scanner's status poll picks the answer up from the cache."""
    key = f"http:https://{name}"
    if cached_only("http", f"https://{name}") is None and key not in _inflight:
        asyncio.get_running_loop().create_task(sni(name))
