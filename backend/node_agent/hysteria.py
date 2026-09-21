"""Runs `hysteria server` on the node, the same way main.py runs Xray.

Hysteria2 is a separate program from Xray with its own config file and its own
process, so the agent treats it as a third service beside Xray and the IPsec
stack: the panel pushes a small payload, this module writes the YAML the binary
wants and (re)starts it.

Two things here are less obvious than the rest.

**Authentication does not live in the config.** Writing every user's password
into the YAML would mean rewriting it and restarting the server on every user
change, dropping everyone's connection each time a subscription is sold. So the
server is pointed at the agent's own loopback endpoint, and the agent forwards
each question to the panel using the node API key it already holds. No value
derived from the panel's secret key is ever stored on the node.

**The egress rate is capped on purpose.** Measured from one MCI phone, this
server reached 40 Mbps on Zoom's media port and yet felt *worse* to use than
3 Mbps on port 53 — because a mobile radio link buffers deeply, and filling that
buffer cost 300-500 ms of latency, which is what decides whether a page opens
now or in three seconds. Capping well below the ceiling keeps that queue empty.
The cap is applied with tc on the node's own egress for that UDP port only, so
nothing else on the machine is shaped.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import yaml

HYSTERIA_BIN = os.environ.get("HYSTERIA_BIN", "hysteria")
CONFIG_PATH = Path(os.environ.get("HYSTERIA_CONFIG_PATH", "./data/hysteria-config.yaml"))
# The certificate the node already has for its own TLS API is self-signed, which
# a Hysteria2 client would refuse, so the panel's real certificate is mounted at
# this path on the node exactly as it is for the panel itself.
CERT_PATH = Path(os.environ.get("HYSTERIA_CERT", "/certs/fullchain.pem"))
KEY_PATH = Path(os.environ.get("HYSTERIA_KEY", "/certs/privkey.pem"))
# The last payload the panel pushed, kept so a container restart can bring the server back without
# waiting for the next push — the same reason main.py restarts Xray from its saved config.
STATE_PATH = CONFIG_PATH.with_name("hysteria-state.json")
# Loopback only, and read by the agent itself rather than by the panel.
STATS_LISTEN = "127.0.0.1:9998"

_process: subprocess.Popen | None = None
_started_at: float | None = None
_state: dict = {"port": None, "rate_mbps": None, "panel_url": None}
# Generated here, never pushed: it only guards a loopback socket on this machine
# and the agent is the sole reader, so the panel has no reason to know it.
_stats_secret: str = os.urandom(16).hex()


def stats_api() -> tuple[str, str]:
    """Where and how the agent reads this server's traffic counters."""
    return f"http://{STATS_LISTEN}", _stats_secret


def _build_yaml(payload: dict, agent_port: int) -> str:
    port = int(payload["port"])
    cfg: dict = {
        "listen": f":{port}",
        "tls": {"cert": str(CERT_PATH), "key": str(KEY_PATH)},
        # The agent answers here and relays to the panel; see the module docstring. HTTPS because
        # that is all the agent speaks (node_agent/tls.py), and `insecure` because its certificate is
        # self-signed — which is safe to skip verifying here only because this is the loopback, where
        # nothing can sit in between. Plain http:// to that port fails the TLS handshake, and every
        # client then sees "authentication error, HTTP status code: 502".
        "auth": {
            "type": "http",
            "http": {"url": f"https://127.0.0.1:{agent_port}/hysteria/auth", "insecure": True},
        },
        "trafficStats": {"listen": STATS_LISTEN, "secret": _stats_secret},
        # A bare Hysteria2 handshake is a QUIC handshake, which Iranian networks
        # drop wholesale, so without obfuscation a server that works everywhere
        # else is unreachable from inside Iran for that reason alone.
        "obfs": {"type": "salamander", "salamander": {"password": payload["obfs"]}},
        # Anything that reaches the port without authenticating gets a proxy of a
        # real site rather than an error that identifies the program.
        "masquerade": {"type": "proxy", "proxy": {"url": "https://127.0.0.1:443/", "rewriteHost": True}},
        # Pin both directions to BBR whatever a client app claims its bandwidth
        # is: left to itself the server would pace with Brutal at the client's
        # declared rate and treat loss as noise, so an app with "100 Mbps" typed
        # in would drive the link into heavy loss.
        "ignoreClientBandwidth": True,
        # Lower gains than standard BBR, drains the queue it builds, and cuts its
        # rate on detected overshoot — the right shape for a path that polices
        # rather than queues, and latency is what this is all optimising for.
        "congestion": {"type": "bbr", "bbrProfile": "conservative"},
        "quic": {
            "initStreamReceiveWindow": 26843545,
            "maxStreamReceiveWindow": 26843545,
            "initConnReceiveWindow": 67108864,
            "maxConnReceiveWindow": 67108864,
            # Hysteria's default is 30s and on MCI connections died at almost
            # exactly that, on a path that was demonstrably still alive.
            "maxIdleTimeout": "60s",
        },
    }
    return yaml.safe_dump(cfg, sort_keys=False)


def _tc(*args: str) -> None:
    subprocess.run(["tc", *args], capture_output=True, text=True, timeout=10)


def _shape(port: int, rate_mbps: int | None) -> None:
    """Limit egress from this UDP port, leaving every other flow alone.

    The default class keeps the interface's previous `fq` behaviour at line rate,
    so the node's Xray traffic and any IPsec users are untouched; only packets
    leaving the Hysteria2 port land in the shaped class, which uses fq_codel so
    the queue we introduce here stays shallow instead of moving the delay onto
    our own side.
    """
    dev = os.environ.get("HYSTERIA_SHAPE_DEV", "eth0")
    if not shutil.which("tc"):
        return
    _tc("qdisc", "del", "dev", dev, "root")
    if rate_mbps is None:
        _tc("qdisc", "add", "dev", dev, "root", "fq")
        return
    rate = f"{int(rate_mbps)}mbit"
    _tc("qdisc", "add", "dev", dev, "root", "handle", "1:", "htb", "default", "10")
    # Explicit quantum on the two line-rate classes: HTB derives it as rate/r2q, which at 10gbit is
    # far past its 200000-byte limit, and it warns and clamps. Stating it removes the guesswork
    # from a command that reshapes the whole interface.
    _tc("class", "add", "dev", dev, "parent", "1:", "classid", "1:1", "htb", "rate", "10gbit", "quantum", "60000")
    _tc("class", "add", "dev", dev, "parent", "1:1", "classid", "1:10", "htb", "rate", "10gbit", "ceil", "10gbit", "quantum", "60000")
    _tc("class", "add", "dev", dev, "parent", "1:1", "classid", "1:20", "htb", "rate", rate, "ceil", rate)
    _tc("qdisc", "add", "dev", dev, "parent", "1:10", "handle", "10:", "fq")
    _tc("qdisc", "add", "dev", dev, "parent", "1:20", "handle", "20:", "fq_codel")
    _tc(
        "filter", "add", "dev", dev, "protocol", "ip", "parent", "1:0", "prio", "1", "u32",
        "match", "ip", "protocol", "17", "0xff",
        "match", "ip", "sport", str(port), "0xffff",
        "flowid", "1:20",
    )


def stop() -> None:
    global _process, _started_at
    if _process is not None and _process.poll() is None:
        _process.terminate()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()
    _process = None
    _started_at = None


def apply_config(payload: dict, agent_port: int) -> dict:
    """Writes the config and restarts the server. Called on every sync, so it
    has to be idempotent — the panel re-syncs a node whenever any user's status
    changes, and restarting on each of those would drop every connection."""
    global _process, _started_at

    if not payload.get("port") or not payload.get("obfs"):
        raise ValueError("a hysteria2 core needs both a port and an obfuscation password")

    text = _build_yaml(payload, agent_port)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    unchanged = CONFIG_PATH.exists() and CONFIG_PATH.read_text() == text
    running = _process is not None and _process.poll() is None
    _state.update(
        port=int(payload["port"]),
        rate_mbps=payload.get("rate_mbps"),
        panel_url=(payload.get("panel_url") or "").rstrip("/") or None,
    )

    if unchanged and running:
        # Shaping is re-asserted even so: it lives in the kernel, not in the
        # config file, and a reboot or someone else's tc command clears it.
        _shape(_state["port"], _state["rate_mbps"])
        return {"status": "unchanged", "port": _state["port"]}

    CONFIG_PATH.write_text(text)
    os.chmod(CONFIG_PATH, 0o600)
    STATE_PATH.write_text(json.dumps({"payload": payload, "agent_port": agent_port}))
    os.chmod(STATE_PATH, 0o600)
    stop()
    _process = subprocess.Popen([HYSTERIA_BIN, "server", "-c", str(CONFIG_PATH)])
    _started_at = time.monotonic()
    _shape(_state["port"], _state["rate_mbps"])
    return {"status": "applied", "port": _state["port"]}


def resume() -> None:
    """Brings the server back after a container restart, from the last payload the panel pushed.

    Rebuilt rather than re-run from the old YAML: the stats secret is generated fresh each time the
    agent starts, so the old file would point Hysteria at a secret this process no longer holds, and
    the agent would stop being able to read usage. Shaping is re-applied too, since it lives in the
    kernel and a reboot clears it.
    """
    if not STATE_PATH.exists():
        return
    try:
        saved = json.loads(STATE_PATH.read_text())
        apply_config(saved["payload"], int(saved["agent_port"]))
    except (OSError, ValueError, KeyError):
        # A damaged state file must not stop the agent itself from starting; the panel's next push
        # rewrites it.
        pass


def panel_url() -> str | None:
    return _state["panel_url"]


def health() -> dict:
    running = _process is not None and _process.poll() is None
    return {
        "running": running,
        "pid": _process.pid if running else None,
        "uptime_seconds": (time.monotonic() - _started_at) if (running and _started_at) else None,
        "port": _state["port"],
        "rate_mbps": _state["rate_mbps"],
    }
