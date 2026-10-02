"""Throwaway REALITY inbounds for testing candidate names from inside Iran.

Nothing outside Iran can tell whether an operator lets a given SNI through
to *this node's address*, so the node opens test inbounds on its public
address and the probe (backend/reality_probe), run on the operator itself,
measures each one. They run in their own Xray process, never touching the
node's live config, and stop on their own after the TTL.

An item serves either one name (dest = that name, exactly like a real
inbound, so an active probe sees the right site) or many names on one port
(serverNames = all of them, dest = the first): the quick first round puts a
hundred names through a single port instead of opening a hundred.
"""

import asyncio
import base64
import json
import os
import random
import re
import socket
import tempfile
import time
import uuid
from contextlib import suppress

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

XRAY_BIN = os.environ.get("XRAY_BIN", "xray")
_PORT_RANGE = (20000, 60000)
_MAX_ITEMS = 100
_MAX_NAMES = 300
_MAX_TTL = 3600
_LOG_RE = re.compile(r"from (?:tcp:)?\[?([0-9a-fA-F.:]+?)\]?:\d+ accepted .*\[(rt-\d+) ")

_state: dict | None = None
_proc: asyncio.subprocess.Process | None = None
# Earlier rounds kept running beside the current one (start(keep_previous=True)).
_kept: list[asyncio.subprocess.Process] = []
_stopper: asyncio.Task | None = None


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _keypair() -> tuple[str, str]:
    key = X25519PrivateKey.generate()
    priv = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return _b64(priv), _b64(pub)


def _port_free(port: int, taken: set[int]) -> bool:
    if port in taken or not 1 <= port <= 65535:
        return False
    with socket.socket() as s:
        # Xray binds with SO_REUSEADDR too, so a port the previous test left
        # in TIME_WAIT is free for it.
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("0.0.0.0", port))
        except OSError:
            return False
    return True


def _pick_port(want: int | None, taken: set[int]) -> int:
    if want and _port_free(want, taken):
        return want
    for _ in range(200):
        port = random.randint(*_PORT_RANGE)
        if _port_free(port, taken):
            return port
    raise RuntimeError("no free port")


def _inbound(it: dict, uid: str, priv: str, sid: str) -> dict:
    return {
        "tag": it["tag"], "listen": "0.0.0.0", "port": it["port"], "protocol": "vless",
        "settings": {"clients": [{"id": uid, "flow": "xtls-rprx-vision"}], "decryption": "none"},
        "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {
            "dest": it["dest"], "serverNames": it["hosts"], "privateKey": priv, "shortIds": [sid],
        }},
    }


async def start(items: list[dict], ttl: int, public_ip: str | None, keep_previous: bool = False) -> dict:
    """items: [{"hosts": [sni, ...], "dest": optional, "port": optional, "label": optional}].

    keep_previous leaves the running test up beside the new one: the probe
    talks to the panel through one of its inbounds, since the panel itself
    may not open on the operator being tested."""
    global _state, _proc, _stopper
    if keep_previous and _proc is not None and _proc.returncode is None:
        _kept.append(_proc)
        _proc = None
        if _stopper is not None:  # the new timer below ends both
            _stopper.cancel()
    else:
        await stop()
    ttl = max(60, min(int(ttl or 1800), _MAX_TTL))
    clean = []
    taken: set[int] = set()
    total = 0
    for i, it in enumerate(items[:_MAX_ITEMS]):
        hosts = [h for h in dict.fromkeys(str(h).strip().lower() for h in it.get("hosts") or []) if h]
        hosts = hosts[: _MAX_NAMES - total]
        if not hosts:
            continue
        total += len(hosts)
        port = _pick_port(it.get("port"), taken)
        taken.add(port)
        dest = str(it.get("dest") or hosts[0]).strip().lower()
        clean.append({"tag": f"rt-{i}", "hosts": hosts, "dest": dest if ":" in dest else f"{dest}:443", "port": port, "label": it.get("label")})
    if not clean:
        raise ValueError("no names to test")
    priv, pub = _keypair()
    uid, sid = str(uuid.uuid4()), "%08x" % random.getrandbits(32)
    tmp = tempfile.mkdtemp(prefix="tifusi-reality-")
    log_path = os.path.join(tmp, "access.log")
    cfg = {
        "log": {"loglevel": "warning", "access": log_path},
        "inbounds": [_inbound(it, uid, priv, sid) for it in clean],
        "outbounds": [{"protocol": "freedom", "tag": "direct"}],
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
        "uuid": uid, "public_key": pub, "short_id": sid, "log": log_path,
        "started_at": now, "expires_at": now + ttl, "items": clean,
        "local_ips": {"127.0.0.1", "::1", *([public_ip] if public_ip else [])},
    }
    _stopper = asyncio.get_running_loop().create_task(_stop_later(ttl))
    return status()


async def _stop_later(ttl: int) -> None:
    await asyncio.sleep(ttl)
    await stop(from_timer=True)


async def stop(from_timer: bool = False) -> None:
    global _proc, _stopper
    if _stopper is not None and not from_timer:
        _stopper.cancel()
    _stopper = None
    for proc in [*_kept, _proc]:
        if proc is not None and proc.returncode is None:
            with suppress(ProcessLookupError):
                proc.terminate()
            with suppress(Exception):
                await asyncio.wait_for(proc.wait(), timeout=3)
    _kept.clear()
    _proc = None



def _clients(path: str, local_ips: set[str]) -> dict[str, set[str]]:
    hits: dict[str, set[str]] = {}
    with suppress(OSError), open(path, errors="replace") as f:
        for line in f:
            m = _LOG_RE.search(line)
            if m and m.group(1) not in local_ips:
                hits.setdefault(m.group(2), set()).add(m.group(1))
    return hits


def status() -> dict:
    if _state is None:
        return {"active": False, "items": []}
    active = _proc is not None and _proc.returncode is None
    hits = _clients(_state["log"], _state["local_ips"])
    return {
        "active": active, "uuid": _state["uuid"], "public_key": _state["public_key"], "short_id": _state["short_id"],
        "started_at": _state["started_at"], "expires_at": _state["expires_at"],
        "items": [{"hosts": it["hosts"], "port": it["port"], "label": it.get("label"),
                   "client_ips": sorted(hits.get(it["tag"], ()))[:10]} for it in _state["items"]],
    }
