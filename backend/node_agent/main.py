"""The process that actually runs on a node: takes the config the panel
pushes, (re)starts Xray-core pointed at it, and reports whether it's alive.

Served over HTTPS with a self-signed cert (see node_agent/tls.py, and
node_agent/serve.py which is the actual process entrypoint) plus a shared
API key, rather than the mTLS gRPC bridge a production system would
eventually want — that's real future work, not a shortcut taken for lack
of caring: getting the panel <-> node config/health contract right first
is what everything else builds on.
"""

import hmac
import json
import os
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException

from node_agent import field_test, hysteria, ipsec, ipsec_stats, limits, reality_scan

try:  # copied in from app/tunnels/cdn_scan.py by node_agent/Dockerfile
    from node_agent import cdn_scan
except ImportError:  # running from the source tree
    from app.tunnels import cdn_scan

API_KEY = os.environ.get("TIFUSI_NODE_API_KEY", "")
XRAY_BIN = os.environ.get("XRAY_BIN", "xray")
# The port this agent itself listens on, read the same way serve.py reads it.
# Hysteria2's config has to point back at it, since the agent is what answers
# that server's authentication questions.
AGENT_PORT = int(os.environ.get("AGENT_PORT", "62050"))
CONFIG_PATH = Path(os.environ.get("XRAY_CONFIG_PATH", "./data/xray-config.json"))

# Must match app/xray_config/builder.py's STATS_API_PORT — that's the port
# the pushed config tells Xray to expose its StatsService on.
STATS_API_ADDR = "127.0.0.1:10085"

app = FastAPI(title="Tifusi Node Agent")

# Best effort: a node without ppp (or a read-only /etc) still serves Xray
# and IKEv2; only L2TP accounting would be missing.
try:
    ipsec_stats.install_ppp_hooks()
except OSError:
    pass

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

# A container restart would otherwise leave every user offline until the
# panel's next push: start Xray again from the last config it was given.
if CONFIG_PATH.exists():
    try:
        _process = subprocess.Popen([XRAY_BIN, "run", "-config", str(CONFIG_PATH)])
        _started_at = time.monotonic()
    except OSError:
        _process = None

limits.start(XRAY_BIN, STATS_API_ADDR, lambda: _process is not None and _process.poll() is None)

# Same reason as Xray above: without it a restarted node serves no Hysteria2 until the panel next
# pushes, which only happens when something changes.
hysteria.resume()


def _check_key(x_node_api_key: str | None) -> None:
    # hmac.compare_digest, not `!=`: a plain string compare short-circuits
    # on the first mismatched byte, which leaks (via response timing) how
    # many leading bytes of a guess are already correct.
    if not API_KEY or not x_node_api_key or not hmac.compare_digest(x_node_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid node API key")


def _get_xray_version() -> str | None:
    global _xray_version
    if _xray_version is not None:
        return _xray_version
    try:
        result = subprocess.run([XRAY_BIN, "version"], capture_output=True, text=True, timeout=5)
        # Just the number out of "Xray 1.8.24 (Xray, Penetrates Everything.) ...":
        # the full banner overflows the panel's nodes.xray_version column.
        first_line = result.stdout.splitlines()[0] if result.stdout else ""
        parts = first_line.split()
        _xray_version = parts[1] if len(parts) > 1 and parts[0] == "Xray" else (first_line or None)
    except Exception:
        _xray_version = None
    return _xray_version


@app.post("/config")
async def apply_config(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    global _process, _started_at

    payload = limits.prepare_xray_config(payload)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(payload))

    if _process is not None and _process.poll() is None:
        _process.terminate()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()
    limits.xray_restarted()

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
    limits.set_ipsec_limits(payload.get("users") or [])
    try:
        if core_type == "l2tp":
            ipsec.apply_l2tp(
                payload.get("psk") or "", payload.get("users") or [], payload.get("egress_vless")
            )
        else:
            ipsec.apply_ikev2(
                payload.get("psk") or "",
                payload.get("remote_id"),
                payload.get("users") or [],
                payload.get("certificate"),
                payload.get("certificate_key"),
                payload.get("egress_vless"),
                payload.get("ikev2_auth_mode") or "eap",
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"required binary not found: {exc}") from exc

    return {"status": "applied", "core_type": core_type}


@app.get("/health")
async def health(x_node_api_key: str | None = Header(default=None)) -> dict:
    """Reports Xray, ipsec and Hysteria2 state independently — a node can be
    running all three at once, so the panel (app/nodes/sync.py::_apply_health)
    checks each side against whether it actually assigned that Core, not against
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
    if _ipsec_mode in ("l2tp", "ikev2"):
        ipsec_state["egress_running"] = ipsec.vless_egress.is_egress_running()

    return {"xray": xray, "ipsec": ipsec_state, "hysteria": hysteria.health()}


@app.get("/stats")
async def stats(x_node_api_key: str | None = Header(default=None)) -> dict:
    """Per-user traffic since the last call — `-reset` makes Xray zero each
    counter out as it's read, so the panel (app/traffic/sync.py) can just
    add whatever comes back onto used_traffic without tracking a baseline
    itself or ever double-counting a byte. IKEv2 and L2TP users never pass
    through Xray; node_agent/ipsec_stats.py keeps the same since-last-call
    contract for them."""
    _check_key(x_node_api_key)

    users: dict[str, dict[str, int]] = {}
    for username, (uplink, downlink) in ipsec_stats.read_deltas().items():
        bucket = users.setdefault(username, {"uplink": 0, "downlink": 0})
        bucket["uplink"] += uplink
        bucket["downlink"] += downlink

    if _process is None or _process.poll() is not None:
        return {"users": users}

    try:
        result = subprocess.run(
            [XRAY_BIN, "api", "statsquery", f"-server={STATS_API_ADDR}", "-pattern=user>>>", "-reset"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        data = json.loads(result.stdout or "{}")
    except Exception:
        return {"users": users}

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


@app.post("/reality/scan")
async def reality_scan_start(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    """Starts a REALITY target scan in the background (node_agent/reality_scan.py);
    the panel polls GET /reality/scan for progress. One scan at a time."""
    _check_key(x_node_api_key)
    if reality_scan.running():
        raise HTTPException(status_code=409, detail="A scan is already running on this node")
    reality_scan.start(
        public_ip=payload.get("public_ip"),
        ring=max(0, min(int(payload.get("ring", 0)), 64)),
        exclude=[str(h) for h in payload.get("exclude") or []][:5000],
    )
    return reality_scan.status()


@app.get("/reality/scan")
async def reality_scan_status(x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    return reality_scan.status()


@app.post("/reality/prove")
async def reality_scan_prove(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    """The scan's second half: run the per-fingerprint REALITY test on the
    names the panel found to be really open from inside Iran."""
    _check_key(x_node_api_key)
    if reality_scan.running():
        raise HTTPException(status_code=409, detail="A scan is already running on this node")
    hosts = [str(h).strip().lower() for h in payload.get("hosts") or [] if str(h).strip()][:12]
    reality_scan.prove_hosts(hosts)
    return reality_scan.status()


@app.post("/reality/field-test")
async def reality_field_test_start(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    """Opens throwaway REALITY inbounds, one per SNI, to be tested from a phone
    in Iran (node_agent/field_test.py). Replaces any test already running."""
    _check_key(x_node_api_key)
    targets = [
        {"host": str(t.get("host") or "").strip().lower(), "dest": str(t.get("dest") or "").strip() or None,
         "port": t["port"] if isinstance(t.get("port"), int) and 1024 <= t["port"] <= 65535 else None,
         "label": str(t.get("label") or "")[:40] or None,
         "transport": "xhttp" if t.get("transport") == "xhttp" else "tcp"}
        for t in payload.get("targets") or [] if isinstance(t, dict)
    ]
    targets = [t for t in targets if t["host"] and len(t["host"]) <= 253 and not any(ch.isspace() for ch in t["host"])]
    if not targets:
        raise HTTPException(status_code=400, detail="targets are required")
    ttl = max(300, min(int(payload.get("ttl") or 1800), 7200))
    try:
        return await field_test.start(targets, ttl, payload.get("public_ip"))
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/reality/field-test")
async def reality_field_test_status(x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    return await field_test.status()


@app.delete("/reality/field-test")
async def reality_field_test_stop(x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    await field_test.stop()
    return await field_test.status()


# --- Hysteria2 --------------------------------------------------------------
# Hysteria2 is a separate program next to Xray, and its statistics API listens
# on this machine's loopback, which the panel cannot reach. The agent is the
# one thing on the node the panel already talks to, so it relays: usage since
# the last call (the counters are cleared as they are read, exactly as Xray's
# are for /stats, so the panel only ever adds deltas) and who is online, and
# it can drop users the panel no longer wants connected.

# Kept for a node whose Hysteria2 was started by hand before the panel could
# push one. When the panel has pushed a config, the agent runs the server itself
# and knows the API without being told.
HYSTERIA_API = os.environ.get("HYSTERIA_API", "")
HYSTERIA_SECRET = os.environ.get("HYSTERIA_SECRET", "")


@app.post("/hysteria-config")
async def apply_hysteria_config(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    """Third service slot, beside /config for Xray and /ipsec-config."""
    _check_key(x_node_api_key)
    try:
        # The panel knows which port it reaches this agent on; fall back to our own
        # environment if an older panel does not send it.
        return hysteria.apply_config(payload, int(payload.get("agent_port") or AGENT_PORT))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/hysteria/auth")
async def hysteria_auth(payload: dict) -> dict:
    """Answers the Hysteria2 server this agent runs, by asking the panel.

    Deliberately not behind _check_key: the caller is the local Hysteria2
    process, which has no node API key and cannot be given one, so this is bound
    to the loopback by the config that points at it. It carries no credential of
    its own either — the agent adds the node API key when it forwards, and the
    only thing that crosses is a password the caller already sent.
    """
    import httpx

    base = hysteria.panel_url()
    if not base:
        raise HTTPException(status_code=503, detail="no panel address pushed yet")
    try:
        async with httpx.AsyncClient(timeout=5.0, verify=True) as client:
            resp = await client.post(
                f"{base}/api/hysteria/auth/node",
                json={"auth": str(payload.get("auth") or "")},
                headers={"X-Node-Api-Key": API_KEY},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError:
        # A refusal is safer than a guess: letting someone in because the panel
        # was briefly unreachable would ignore expiry and data limits entirely.
        return {"ok": False}


def _hysteria(method: str, path: str, json_body=None):
    import httpx

    api, secret = HYSTERIA_API, HYSTERIA_SECRET
    if hysteria.health()["running"]:
        api, secret = hysteria.stats_api()
    if not api:
        raise HTTPException(status_code=404, detail="Hysteria2 is not set up on this node")
    try:
        resp = httpx.request(method, f"{api}{path}", headers={"Authorization": secret}, json=json_body, timeout=5.0)
        resp.raise_for_status()
        return resp.json() if resp.content else {}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Hysteria2 API: {exc.__class__.__name__}") from exc


@app.get("/hysteria/stats")
async def hysteria_stats(x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    traffic = _hysteria("GET", "/traffic?clear=1")
    online = _hysteria("GET", "/online")
    return {"users": {name: {"uplink": c.get("rx", 0), "downlink": c.get("tx", 0)} for name, c in traffic.items()}, "online": online}


@app.post("/hysteria/kick")
async def hysteria_kick(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_node_api_key)
    ids = [str(i) for i in payload.get("ids") or []][:500]
    if ids:
        _hysteria("POST", "/kick", ids)
    return {"kicked": len(ids)}


@app.post("/cdn/check")
async def cdn_check(payload: dict, x_node_api_key: str | None = Header(default=None)) -> dict:
    """Runs one of the tunnel CDN checks (app/tunnels/cdn_scan.py) from this
    server, which is the tunnel's foreign side — the one that dials the CDN."""
    _check_key(x_node_api_key)
    kind = payload.get("kind")
    provider = payload.get("provider") if payload.get("provider") in cdn_scan.RANGE_URLS else "arvan"
    host = str(payload.get("host") or "")
    path = str(payload.get("path") or "/")
    port = int(payload.get("port") or 443)
    if not host or len(host) > 253 or any(ch.isspace() for ch in host):
        raise HTTPException(status_code=400, detail="host is required")
    if kind == "edges":
        return await cdn_scan.scan_edges(provider, host, path, port, sni=payload.get("sni") or None)
    if kind == "fronts":
        return await cdn_scan.scan_fronts(provider, host, path, port, edge=payload.get("edge") or None)
    if kind == "speed":
        return await cdn_scan.speed_test(
            str(payload.get("addr") or host), port, str(payload.get("sni") or host), host, path, str(payload.get("token") or "")
        )
    raise HTTPException(status_code=400, detail="unknown check")

