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

API_KEY = os.environ.get("TIFUSI_NODE_API_KEY", "")
XRAY_BIN = os.environ.get("XRAY_BIN", "xray")
CONFIG_PATH = Path(os.environ.get("XRAY_CONFIG_PATH", "./data/xray-config.json"))

app = FastAPI(title="Tifusi Node Agent")

_process: subprocess.Popen | None = None
_started_at: float | None = None
_xray_version: str | None = None


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


@app.get("/health")
async def health(x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    running = _process is not None and _process.poll() is None
    uptime = (time.monotonic() - _started_at) if (running and _started_at) else None
    return {
        "running": running,
        "pid": _process.pid if running else None,
        "uptime_seconds": uptime,
        "xray_version": _get_xray_version(),
    }
