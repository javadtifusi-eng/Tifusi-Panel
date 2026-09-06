"""The process that actually runs on a node: takes the config the panel
pushes, (re)starts Xray-core pointed at it, and reports whether it's alive.

Talks to the panel over plain HTTP + a shared API key rather than the
mTLS gRPC bridge a production system would eventually want — that's real
future work, not a shortcut taken for lack of caring: getting the
panel <-> node config/health contract right first is what everything
else builds on.
"""

import json
import os
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException

from node_agent import ipsec

API_KEY = os.environ.get("TIFUSI_NODE_API_KEY", "")
XRAY_BIN = os.environ.get("XRAY_BIN", "xray")
CONFIG_PATH = Path(os.environ.get("XRAY_CONFIG_PATH", "./data/xray-config.json"))

# Must match app/xray_config/builder.py's STATS_API_PORT — that's the port
# the pushed config tells Xray to expose its StatsService on.
STATS_API_ADDR = "127.0.0.1:10085"

app = FastAPI(title="Tifusi Node Agent")

_process: subprocess.Popen | None = None
_started_at: float | None = None
_xray_version: str | None = None

# Which ipsec core type (if any) this node currently has configured — a
# node can run Xray *and* l2tp/ikev2 at the same time (the panel's
# app/nodes/sync.py pushes to both /config and /ipsec-config independently
# when a node has both an Xray and an ipsec Core assigned), so this is
# tracked separately from the Xray process above instead of as a single
# exclusive mode. Stays None on a node with no ipsec Core assigned — it
# never gets a /ipsec-config push, so /health reports ipsec as not
# configured rather than guessing at a mode.
_ipsec_mode: str | None = None


def _check_key(x_node_api_key: str | None) -> None:
    if not API_KEY or x_node_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid node API key")


def _get_xray_version() -> str | None:
    global _xray_version
    if _xray_version is not None:
        return _xray_version
    try:
        result = subprocess.run([XRAY_BIN, "version"], capture_output=True, text=True, timeout=5)
        _xray_version = result.stdout.splitlines()[0] if result.stdout else None
    except Exception:
        _xray_version = None
    return _xray_version


@app.post("/config")
async def apply_config(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    global _process, _started_at

    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(payload))

    if _process is not None and _process.poll() is None:
        _process.terminate()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()

    try:
        _process = subprocess.Popen([XRAY_BIN, "run", "-config", str(CONFIG_PATH)])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"xray binary not found: {exc}") from exc

    _started_at = time.monotonic()
    return {"status": "applied", "pid": _process.pid}


@app.post("/ipsec-config")
async def apply_ipsec_config(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    global _ipsec_mode

    core_type = payload.get("core_type")
    if core_type not in ("l2tp", "ikev2"):
        raise HTTPException(status_code=400, detail=f"Unknown core_type: {core_type!r}")

    # Set before applying, not after: if this fails partway (e.g. a binary
    # genuinely missing), /health should still judge the ipsec side using
    # this mode's checks rather than silently reporting it unconfigured.
    _ipsec_mode = core_type
    try:
        if core_type == "l2tp":
            ipsec.apply_l2tp(payload.get("psk") or "", payload.get("users") or [])
        else:
            ipsec.apply_ikev2(payload.get("psk") or "", payload.get("remote_id"), payload.get("users") or [])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"required binary not found: {exc}") from exc

    return {"status": "applied", "core_type": core_type}


@app.get("/health")
async def health(x_node_api_key: str | None = Header(default=None)) -> dict:
    """Reports Xray and ipsec state independently — a node can be running
    both at once, so the panel (app/nodes/sync.py::_apply_health) checks
    each side against whether it actually assigned that Core, not against
    a single overall 'running' flag."""
    _check_key(x_node_api_key)

    running = _process is not None and _process.poll() is None
    uptime = (time.monotonic() - _started_at) if (running and _started_at) else None
    xray = {
        "running": running,
        "pid": _process.pid if running else None,
        "uptime_seconds": uptime,
        "version": _get_xray_version(),
    }

    if _ipsec_mode == "l2tp":
        ipsec_running = ipsec.is_ipsec_running() and ipsec.is_xl2tpd_running()
    elif _ipsec_mode == "ikev2":
        ipsec_running = ipsec.is_ipsec_running()
    else:
        ipsec_running = None
    ipsec_state = {"mode": _ipsec_mode, "running": ipsec_running}

    return {"xray": xray, "ipsec": ipsec_state}


@app.get("/stats")
async def stats(x_node_api_key: str | None = Header(default=None)) -> dict:
    """Per-user traffic since the last call — `-reset` makes Xray zero each
    counter out as it's read, so the panel (app/traffic/sync.py) can just
    add whatever comes back onto used_traffic without tracking a baseline
    itself or ever double-counting a byte."""
    _check_key(x_node_api_key)
    if _process is None or _process.poll() is not None:
        return {"users": {}}

    try:
        result = subprocess.run(
            [XRAY_BIN, "api", "statsquery", f"-server={STATS_API_ADDR}", "-pattern=user>>>", "-reset"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        data = json.loads(result.stdout or "{}")
    except Exception:
        return {"users": {}}

    users: dict[str, dict[str, int]] = {}
    for entry in data.get("stat", []):
        # Xray names each counter "user>>>{email}>>>traffic>>>{uplink|downlink}".
        parts = entry.get("name", "").split(">>>")
        if len(parts) != 4:
            continue
        _, username, _, direction = parts
        bucket = users.setdefault(username, {"uplink": 0, "downlink": 0})
        try:
            bucket[direction] = bucket.get(direction, 0) + int(entry.get("value", 0))
        except ValueError:
            continue

    return {"users": users}
