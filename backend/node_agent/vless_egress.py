"""Chains a node's L2TP clients through a *different* panel's VLESS server
instead of NAT'ing them straight to the internet.

Only ever touched when a Node has `l2tp_egress_vless` set (see
app/models/node.py) — a node with it unset keeps ipsec.py's plain
MASQUERADE/FORWARD behavior untouched.

How it works: a second, fully isolated Xray process runs here with a
single vless outbound (parsed from the pasted share link) fronted by a
dokodemo-door inbound in TPROXY mode. Linux policy routing then makes
packets sourced from the l2tp pool subnet get delivered to that inbound
transparently — the far VLESS server's connection becomes the real
internet-facing hop, this node's own uplink never sees the plaintext
destination. The node's *own* Xray core (node_agent/main.py's `_process`)
is untouched — this is a second, independent xray invocation with its
own config file and port.
"""

import json
import os
import subprocess
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

XRAY_BIN = os.environ.get("XRAY_BIN", "xray")
EGRESS_CONFIG_PATH = Path("/app/data/egress-xray-config.json")
TPROXY_PORT = 12345
TPROXY_MARK = "1"
TPROXY_TABLE = "100"


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=False, capture_output=True, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return subprocess.CompletedProcess(cmd, returncode=127)


def parse_vless(uri: str) -> dict:
    """vless://<uuid>@<host>:<port>?type=...&security=...&...#remark"""
    if not uri.startswith("vless://"):
        raise ValueError("not a vless:// link")
    parsed = urlparse(uri)
    if not parsed.username or not parsed.hostname or not parsed.port:
        raise ValueError("vless link is missing uuid/host/port")
    return {
        "uuid": parsed.username,
        "address": parsed.hostname,
        "port": parsed.port,
        "params": dict(parse_qsl(parsed.query)),
    }


def _transport_settings(network: str, params: dict) -> dict:
    if network == "ws":
        settings: dict = {}
        if params.get("path"):
            settings["path"] = params["path"]
        if params.get("host"):
            settings["headers"] = {"Host": params["host"]}
        return {"wsSettings": settings}
    if network == "grpc":
        settings = {}
        if params.get("serviceName"):
            settings["serviceName"] = params["serviceName"]
        if params.get("authority"):
            settings["authority"] = params["authority"]
        return {"grpcSettings": settings}
    if network in ("http", "h2", "httpupgrade", "xhttp"):
        settings = {}
        if params.get("path"):
            settings["path"] = params["path"]
        if params.get("host"):
            settings["host"] = params["host"]
        return {f"{network}Settings": settings}
    # tcp (the default when the link has no `type`) — headerType almost
    # always "none" in the wild; obfuscated http headers are rare enough
    # not to be worth reproducing here.
    return {"tcpSettings": {"header": {"type": params.get("headerType", "none")}}}


def _security_settings(security: str, params: dict) -> dict:
    if security == "tls":
        settings: dict = {}
        if params.get("sni"):
            settings["serverName"] = params["sni"]
        if params.get("fp"):
            settings["fingerprint"] = params["fp"]
        if params.get("alpn"):
            settings["alpn"] = params["alpn"].split(",")
        if params.get("allowInsecure") in ("1", "true", "True"):
            settings["allowInsecure"] = True
        return {"tlsSettings": settings}
    if security == "reality":
        settings = {}
        if params.get("sni"):
            settings["serverName"] = params["sni"]
        if params.get("fp"):
            settings["fingerprint"] = params["fp"]
        if params.get("pbk"):
            settings["publicKey"] = params["pbk"]
        if params.get("sid"):
            settings["shortId"] = params["sid"]
        if params.get("spx"):
            settings["spiderX"] = params["spx"]
        return {"realitySettings": settings}
    return {}


def build_outbound(parsed: dict) -> dict:
    params = parsed["params"]
    network = params.get("type", "tcp")
    security = params.get("security", "none")

    user: dict = {"id": parsed["uuid"], "encryption": params.get("encryption", "none")}
    if params.get("flow"):
        user["flow"] = params["flow"]

    stream_settings = {"network": network, "security": security}
    stream_settings.update(_transport_settings(network, params))
    stream_settings.update(_security_settings(security, params))

    return {
        "tag": "egress-vless",
        "protocol": "vless",
        "settings": {
            "vnext": [{"address": parsed["address"], "port": parsed["port"], "users": [user]}]
        },
        "streamSettings": stream_settings,
    }


def _egress_xray_config(outbound: dict) -> dict:
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [
            {
                "tag": "tproxy-in",
                "listen": "0.0.0.0",
                "port": TPROXY_PORT,
                "protocol": "dokodemo-door",
                "settings": {"network": "tcp,udp", "followRedirect": True},
                "streamSettings": {"sockopt": {"tproxy": "tproxy"}},
            }
        ],
        "outbounds": [outbound],
    }


def _load_tproxy_modules() -> None:
    # Best-effort, same spirit as install-node.sh's l2tp modprobe calls —
    # a host that already has these built into its kernel (common on
    # stock Ubuntu/Debian) doesn't need this to succeed for TPROXY to work.
    for module in ("nf_tproxy_ipv4", "xt_TPROXY", "xt_socket", "xt_mark"):
        _run(["modprobe", module])


def _ensure_policy_routing() -> None:
    rules = _run(["ip", "rule", "show"]).stdout.decode()
    if f"fwmark 0x{int(TPROXY_MARK):x}" not in rules and f"fwmark {TPROXY_MARK}" not in rules:
        _run(["ip", "rule", "add", "fwmark", TPROXY_MARK, "lookup", TPROXY_TABLE])

    routes = _run(["ip", "route", "show", "table", TPROXY_TABLE]).stdout.decode()
    if "local 0.0.0.0/0" not in routes:
        _run(["ip", "route", "add", "local", "0.0.0.0/0", "dev", "lo", "table", TPROXY_TABLE])


def _ensure_tproxy_iptables(subnet_cidr: str) -> None:
    for proto in ("tcp", "udp"):
        check = _run(
            [
                "iptables", "-t", "mangle", "-C", "PREROUTING",
                "-s", subnet_cidr, "-p", proto,
                "-j", "TPROXY", "--on-port", str(TPROXY_PORT), "--on-ip", "127.0.0.1",
                "--tproxy-mark", f"{TPROXY_MARK}/{TPROXY_MARK}",
            ]
        )
        if check.returncode != 0:
            _run(
                [
                    "iptables", "-t", "mangle", "-A", "PREROUTING",
                    "-s", subnet_cidr, "-p", proto,
                    "-j", "TPROXY", "--on-port", str(TPROXY_PORT), "--on-ip", "127.0.0.1",
                    "--tproxy-mark", f"{TPROXY_MARK}/{TPROXY_MARK}",
                ]
            )


def _remove_tproxy_iptables(subnet_cidr: str) -> None:
    for proto in ("tcp", "udp"):
        _run(
            [
                "iptables", "-t", "mangle", "-D", "PREROUTING",
                "-s", subnet_cidr, "-p", proto,
                "-j", "TPROXY", "--on-port", str(TPROXY_PORT), "--on-ip", "127.0.0.1",
                "--tproxy-mark", f"{TPROXY_MARK}/{TPROXY_MARK}",
            ]
        )


_egress_process: subprocess.Popen | None = None


def _stop_egress_process() -> None:
    global _egress_process
    if _egress_process is not None and _egress_process.poll() is None:
        _egress_process.terminate()
        try:
            _egress_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _egress_process.kill()
    _egress_process = None


def is_egress_running() -> bool:
    return _egress_process is not None and _egress_process.poll() is None


def apply(vless_uri: str | None, subnet_cidr: str) -> None:
    """Called on every /ipsec-config push for an l2tp core. `vless_uri` is
    Node.l2tp_egress_vless — None tears the whole thing down and restores
    plain NAT egress (ipsec.py's own MASQUERADE/FORWARD rules are left
    alone either way, since TPROXY diverts matching packets before they'd
    ever reach those chains)."""
    if not vless_uri:
        _stop_egress_process()
        _remove_tproxy_iptables(subnet_cidr)
        return

    outbound = build_outbound(parse_vless(vless_uri))
    EGRESS_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    EGRESS_CONFIG_PATH.write_text(json.dumps(_egress_xray_config(outbound)))

    _stop_egress_process()
    global _egress_process
    _egress_process = subprocess.Popen([XRAY_BIN, "run", "-config", str(EGRESS_CONFIG_PATH)])

    _load_tproxy_modules()
    _ensure_policy_routing()
    _ensure_tproxy_iptables(subnet_cidr)
