"""Runs the WireGuard core on the node, as its own Xray process.

Xray rather than the kernel module, on purpose: Xray ends every client TCP
connection here on the node and carries it onward with the node's own stack
(BBR), so a lossy mobile uplink only has to be recovered over the short
phone-to-node hop instead of end to end. On MCI that is what made uploads
usable at all.

Per-user traffic: every peer has a fixed tunnel address, a routing rule sends
that address to an outbound named after the user, and Xray's own outbound
counters then give each user's usage. The agent folds them into /stats, so the
panel counts WireGuard exactly like everything else.

Sharing UDP 4500 with IKEv2: when the core asks for port 500 or 4500 the server
listens on an internal port instead, and one iptables rule hands it only the
packets that carry WireGuard's signature — a message type of 1-4 followed by
three zero bytes. IKE on 4500 starts with a zero marker and ESP with a random
SPI, so strongSwan keeps everything that is its own. It is used even when the
node has no IPsec, so the order the two services start in never matters.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

XRAY_BIN = os.environ.get("XRAY_BIN", "xray")
CONFIG_PATH = Path(os.environ.get("WIREGUARD_CONFIG_PATH", "./data/wireguard-xray-config.json"))
STATE_PATH = CONFIG_PATH.with_name("wireguard-state.json")
API_ADDR = "127.0.0.1:10087"
INTERNAL_PORT = 51820
SHARED_PORTS = (500, 4500)
OUTBOUND_PREFIX = "wg:"
# WireGuard messages begin with type 1..4 and three zero bytes.
_U32_MATCH = "0>>22&0x3C@8=0x01000000:0x04000000&&0>>22&0x3C@8&0x00FFFFFF=0"

# Spelled out rather than geoip:private so the process never depends on geoip.dat.
_PRIVATE_NETS = [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7", "fe80::/10",
]

_process: subprocess.Popen | None = None
_started_at: float | None = None
_state: dict = {"port": None, "listen_port": None, "peers": 0}


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return subprocess.CompletedProcess(cmd, returncode=127, stdout="", stderr="")


def _redirect_rule(public_port: int) -> list[str]:
    return [
        "PREROUTING", "-p", "udp", "--dport", str(public_port),
        "-m", "u32", "--u32", _U32_MATCH,
        "-j", "REDIRECT", "--to-ports", str(INTERNAL_PORT),
    ]


def _set_redirect(public_port: int | None) -> None:
    """Exactly one redirect for the shared port, or none."""
    for port in SHARED_PORTS:
        rule = _redirect_rule(port)
        while _run(["iptables", "-t", "nat", "-C", *rule]).returncode == 0 and port != public_port:
            _run(["iptables", "-t", "nat", "-D", *rule])
    if public_port in SHARED_PORTS:
        rule = _redirect_rule(public_port)
        if _run(["iptables", "-t", "nat", "-C", *rule]).returncode != 0:
            _run(["iptables", "-t", "nat", "-I", *rule])


def _build_config(payload: dict, listen_port: int) -> dict:
    peers = payload.get("peers") or []
    outbounds = [
        {"tag": "direct", "protocol": "freedom", "settings": {"domainStrategy": "UseIPv4"}},
        {"tag": "block", "protocol": "blackhole"},
    ]
    rules = [
        {"type": "field", "inboundTag": ["api"], "outboundTag": "api"},
        # Nothing from the tunnel may reach the node's own private networks.
        {"type": "field", "ip": _PRIVATE_NETS, "outboundTag": "block"},
    ]
    for peer in peers:
        tag = f"{OUTBOUND_PREFIX}{peer['username']}"
        outbounds.append({"tag": tag, "protocol": "freedom", "settings": {"domainStrategy": "UseIPv4"}})
        rules.append({"type": "field", "source": [peer["address"]], "outboundTag": tag})
    return {
        "log": {"loglevel": "warning"},
        "api": {"tag": "api", "services": ["StatsService"]},
        "stats": {},
        "policy": {"system": {"statsOutboundUplink": True, "statsOutboundDownlink": True}},
        "inbounds": [
            {
                "tag": "wireguard",
                "listen": "0.0.0.0",
                "port": listen_port,
                "protocol": "wireguard",
                "settings": {
                    "secretKey": payload["private_key"],
                    "mtu": int(payload.get("mtu") or 1420),
                    "peers": [
                        {"publicKey": p["public_key"], "allowedIPs": [f"{p['address']}/32"]} for p in peers
                    ],
                },
            },
            {
                "tag": "api",
                "listen": API_ADDR.split(":")[0],
                "port": int(API_ADDR.split(":")[1]),
                "protocol": "dokodemo-door",
                "settings": {"address": "127.0.0.1"},
            },
        ],
        "outbounds": outbounds,
        "routing": {"rules": rules},
    }


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


def apply_config(payload: dict) -> dict:
    """Idempotent: the panel re-syncs on every user change, and restarting on
    each would drop every tunnel, so only a real change restarts Xray."""
    global _process, _started_at
    if not payload.get("private_key") or not payload.get("port"):
        raise ValueError("a wireguard core needs a port and a server key")
    port = int(payload["port"])
    listen_port = INTERNAL_PORT if port in SHARED_PORTS else port
    text = json.dumps(_build_config(payload, listen_port), indent=1)

    _state.update(port=port, listen_port=listen_port, peers=len(payload.get("peers") or []))
    _set_redirect(port if listen_port != port else None)

    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    running = _process is not None and _process.poll() is None
    if running and CONFIG_PATH.exists() and CONFIG_PATH.read_text() == text:
        return {"status": "unchanged", "port": port}

    CONFIG_PATH.write_text(text)
    os.chmod(CONFIG_PATH, 0o600)
    STATE_PATH.write_text(json.dumps({"payload": payload}))
    os.chmod(STATE_PATH, 0o600)
    stop()
    _process = subprocess.Popen([XRAY_BIN, "run", "-config", str(CONFIG_PATH)])
    _started_at = time.monotonic()
    return {"status": "applied", "port": port, "peers": _state["peers"]}


def resume() -> None:
    """Brings the server back after a container restart from the last push."""
    if not STATE_PATH.exists():
        return
    try:
        apply_config(json.loads(STATE_PATH.read_text())["payload"])
    except (OSError, ValueError, KeyError):
        pass


def read_deltas() -> dict[str, tuple[int, int]]:
    """Per-user (uplink, downlink) since the last call, same contract as
    ipsec_stats.read_deltas()."""
    if _process is None or _process.poll() is not None:
        return {}
    result = _run([XRAY_BIN, "api", "statsquery", f"-server={API_ADDR}", f"-pattern=outbound>>>{OUTBOUND_PREFIX}", "-reset"])
    try:
        data = json.loads(result.stdout or "{}")
    except ValueError:
        return {}
    out: dict[str, list[int]] = {}
    for entry in data.get("stat", []):
        # "outbound>>>wg:{username}>>>traffic>>>{uplink|downlink}"
        parts = entry.get("name", "").split(">>>")
        if len(parts) != 4 or not parts[1].startswith(OUTBOUND_PREFIX):
            continue
        username = parts[1][len(OUTBOUND_PREFIX):]
        bucket = out.setdefault(username, [0, 0])
        try:
            bucket[0 if parts[3] == "uplink" else 1] += int(entry.get("value", 0))
        except ValueError:
            continue
    return {name: (up, down) for name, (up, down) in out.items()}


def health() -> dict:
    running = _process is not None and _process.poll() is None
    return {
        "running": running,
        "pid": _process.pid if running else None,
        "uptime_seconds": (time.monotonic() - _started_at) if (running and _started_at) else None,
        "port": _state["port"],
        "peers": _state["peers"],
    }
