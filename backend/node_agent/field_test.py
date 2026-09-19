"""Real test from inside Iran for REALITY targets, run on the node.

Nothing outside Iran can tell whether Iran's DPI lets a given SNI through
to *this node's address* — check-host.net only fetches the name from its
own IP. So the node opens one throwaway REALITY inbound per candidate SNI
on its public address, the admin imports the resulting configs on a phone
on Iranian internet and runs a real-delay (or speed) test, and the node
reports which inbounds actually carried authenticated traffic. A target
is marked working only when a client from outside this server got bytes
back through it.

The inbounds run in their own Xray process, never touching the node's
live config, and stop on their own after the TTL.
"""

import asyncio
import json
import os
import random
import re
import socket
import tempfile
import time
import uuid
from contextlib import suppress

from node_agent.reality_scan import XRAY_BIN, _keypair

_PORT_RANGE = (20000, 60000)
_MAX_TARGETS = 12
_state: dict | None = None
_proc: asyncio.subprocess.Process | None = None
_stopper: asyncio.Task | None = None
_LOG_RE = re.compile(r"from (?:tcp:)?\[?([0-9a-fA-F.:]+?)\]?:\d+ accepted .*\[(probe-\d+) ")


def _free_public_port(taken: set[int]) -> int:
    for _ in range(200):
        port = random.randint(*_PORT_RANGE)
        if port in taken:
            continue
        with socket.socket() as s:
            try:
                s.bind(("0.0.0.0", port))
            except OSError:
                continue
        return port
    raise RuntimeError("no free port")


async def _stats(api_port: int) -> dict[str, dict[str, int]]:
    proc = await asyncio.create_subprocess_exec(
        XRAY_BIN, "api", "statsquery", f"--server=127.0.0.1:{api_port}", "-pattern", "inbound>>>probe-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    result: dict[str, dict[str, int]] = {}
    with suppress(ValueError):
        for item in json.loads(out or b"{}").get("stat", []):
            # inbound>>>probe-3>>>traffic>>>downlink
            parts = item.get("name", "").split(">>>")
            if len(parts) == 4:
                result.setdefault(parts[1], {})[parts[3]] = int(item.get("value", 0))
    return result


def _log_hits(path: str, local_ips: set[str]) -> dict[str, set[str]]:
    hits: dict[str, set[str]] = {}
    with suppress(OSError), open(path, errors="replace") as f:
        for line in f:
            m = _LOG_RE.search(line)
            if m and m.group(1) not in local_ips:
                hits.setdefault(m.group(2), set()).add(m.group(1))
    return hits


async def start(targets: list[dict], ttl: int, public_ip: str | None) -> dict:
    """targets: [{"host": sni, "dest": "ip:443"}]."""
    await stop()
    global _state, _proc, _stopper
    targets = [t for t in targets if t.get("host")][:_MAX_TARGETS]
    if not targets:
        raise ValueError("no targets")
    priv, pub = _keypair()
    uid, sid = str(uuid.uuid4()), "%08x" % random.getrandbits(32)
    taken: set[int] = set()
    items = []
    for i, t in enumerate(targets):
        port = _free_public_port(taken)
        taken.add(port)
        items.append({"tag": f"probe-{i}", "host": t["host"], "dest": t.get("dest") or f"{t['host']}:443", "port": port})
    api_port = _free_public_port(taken)
    tmp = tempfile.mkdtemp(prefix="tifusi-field-")
    log_path = os.path.join(tmp, "access.log")
    cfg = {
        "log": {"loglevel": "warning", "access": log_path},
        "api": {"tag": "api", "services": ["StatsService"]},
        "stats": {},
        "policy": {"system": {"statsInboundUplink": True, "statsInboundDownlink": True}},
        "inbounds": [
            {"tag": "api", "listen": "127.0.0.1", "port": api_port, "protocol": "dokodemo-door", "settings": {"address": "127.0.0.1"}},
            *[{
                "tag": it["tag"], "listen": "0.0.0.0", "port": it["port"], "protocol": "vless",
                "settings": {"clients": [{"id": uid, "flow": "xtls-rprx-vision"}], "decryption": "none"},
                "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {
                    "dest": it["dest"], "serverNames": [it["host"]], "privateKey": priv, "shortIds": [sid]}},
            } for it in items],
        ],
        "outbounds": [{"protocol": "freedom", "tag": "direct"}, {"protocol": "freedom", "tag": "api"}],
        "routing": {"rules": [{"type": "field", "inboundTag": ["api"], "outboundTag": "api"}]},
    }
    cfg_path = os.path.join(tmp, "config.json")
    with open(cfg_path, "w") as f:
        json.dump(cfg, f)
    _proc = await asyncio.create_subprocess_exec(
        XRAY_BIN, "run", "-c", cfg_path, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    await asyncio.sleep(1.0)
    if _proc.returncode is not None:
        _proc = None
        raise RuntimeError("xray refused the test config")
    now = time.time()
    _state = {
        "uuid": uid, "public_key": pub, "short_id": sid, "api_port": api_port, "log": log_path,
        "started_at": now, "expires_at": now + ttl, "items": items,
        "local_ips": {"127.0.0.1", "::1", *([public_ip] if public_ip else [])},
    }
    _state["rates"] = {}
    _stopper = asyncio.get_running_loop().create_task(_stop_later(ttl))
    asyncio.get_running_loop().create_task(_sample())
    return await status()


_SAMPLE_EVERY = 2.0


async def _sample() -> None:
    """Real speed as the phone sees it: the byte counters are read every two
    seconds and each SNI keeps its best download/upload rate — a speed test
    in v2rayNG or any download through that config shows up here."""
    state, last = _state, None
    while _state is state and _proc is not None and _proc.returncode is None:
        now = time.monotonic()
        stats = await _stats(state["api_port"])
        if last is not None:
            dt = now - last[0]
            for tag, s in stats.items():
                prev = last[1].get(tag, {})
                r = state["rates"].setdefault(tag, {"down": 0, "up": 0})
                for key, name in (("down", "downlink"), ("up", "uplink")):
                    r[key] = max(r[key], int((s.get(name, 0) - prev.get(name, 0)) / dt))
        last = (now, stats)
        await asyncio.sleep(_SAMPLE_EVERY)


async def _stop_later(ttl: int) -> None:
    await asyncio.sleep(ttl)
    await stop(from_timer=True)


async def stop(from_timer: bool = False) -> None:
    global _proc, _stopper
    if _stopper is not None and not from_timer:
        _stopper.cancel()
    _stopper = None
    if _proc is not None and _proc.returncode is None:
        with suppress(ProcessLookupError):
            _proc.terminate()
        with suppress(Exception):
            await asyncio.wait_for(_proc.wait(), timeout=3)
    _proc = None
    if _state is not None:
        _state["stopped_at"] = _state.get("stopped_at") or time.time()


async def status() -> dict:
    if _state is None:
        return {"active": False, "items": []}
    active = _proc is not None and _proc.returncode is None
    stats = await _stats(_state["api_port"]) if active else {}
    if active:
        _state["last_stats"] = stats
    else:
        stats = _state.get("last_stats", {})
    hits = _log_hits(_state["log"], _state["local_ips"])
    items = []
    for it in _state["items"]:
        s = stats.get(it["tag"], {})
        down, up = s.get("downlink", 0), s.get("uplink", 0)
        clients = len(hits.get(it["tag"], ()))
        # Accepted in the access log means the REALITY handshake authenticated
        # (an unauthenticated one is just relayed to dest and never logged as
        # accepted), and a client outside this server sent it.
        items.append({"host": it["host"], "dest": it["dest"], "port": it["port"], "clients": clients,
                      "down": down, "up": up, "ok": clients > 0 and down > 0,
                      "down_bps": _state["rates"].get(it["tag"], {}).get("down", 0),
                      "up_bps": _state["rates"].get(it["tag"], {}).get("up", 0)})
    return {
        "active": active, "uuid": _state["uuid"], "public_key": _state["public_key"], "short_id": _state["short_id"],
        "started_at": _state["started_at"], "expires_at": _state["expires_at"], "items": items,
    }
