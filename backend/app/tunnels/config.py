"""Builds the literal config.json content each side of a Tunnel needs —
matches backend/tunnel_agent's own documented shape exactly (see its
README), since the panel never talks to that binary as a managed agent;
it only hands the admin a correct, ready-to-run install command per side.
"""

import base64
import json

from app.models.tunnel import Tunnel, TunnelTransport

_INSTALL_RAW_URL = (
    "https://raw.githubusercontent.com/javadtifusi-eng/"
    "Tifusi-Panel/main/backend/tunnel_agent/install.sh"
)

# The fixed "tunnel-agent" release the build workflow publishes the prebuilt
# binary on — the same one install.sh downloads (see its RELEASE var).
_BINARY_RELEASE_URL = (
    "https://github.com/javadtifusi-eng/Tifusi-Panel/releases/download/tunnel-agent"
)

_MUX_TRANSPORTS = {TunnelTransport.tcpmux, TunnelTransport.wsmux, TunnelTransport.wssmux}


def build_iran_config(tunnel: Tunnel) -> dict:
    config: dict = {
        "mode": "server",
        "listen": f"0.0.0.0:{tunnel.iran_port}",
        "transport": tunnel.transport.value,
        "token": tunnel.token,
    }
    sni = tunnel.cdn_host or tunnel.sni
    if sni:
        config["sni"] = sni
    if tunnel.path:
        config["path"] = tunnel.path
    # Behind a CDN the relay keeps its self-signed certificate: the CDN, not
    # a client, is what connects to it, and Let's Encrypt can't validate a
    # name whose traffic the CDN answers.
    if tunnel.domain and not tunnel.cdn_host:
        config["domain"] = tunnel.domain
    if tunnel.transport == TunnelTransport.spoof:
        # Iran side stamps the forged source and aims its spoofed packets at
        # the foreign side's real address (its listener stays on iran_port).
        config["spoof_source"] = tunnel.spoof_source
        if tunnel.foreign_address:
            config["peer"] = f"{tunnel.foreign_address}:{tunnel.iran_port}"
    config["forwards"] = [
        {
            "name": f["name"],
            "listen": f"0.0.0.0:{f['listen_port']}",
            "net": f["net"],
            "target": f"127.0.0.1:{f['target_port']}",
        }
        for f in tunnel.forwards
    ]
    return config


def build_foreign_config(tunnel: Tunnel) -> dict:
    # Through a CDN the foreign side dials the CDN's name; the CDN hands the
    # WebSocket on to the relay. iran_address stays the address users use.
    server = f"{tunnel.cdn_host}:{tunnel.cdn_port or 443}" if tunnel.cdn_host else f"{tunnel.iran_address}:{tunnel.iran_port}"
    config: dict = {
        "mode": "client",
        "server": server,
        "transport": tunnel.transport.value,
        "token": tunnel.token,
    }
    if tunnel.cdn_host and tunnel.cdn_ips:
        # Pinned clean edges: connections are spread across them and a dead
        # one is skipped, instead of whatever edge DNS hands out.
        config["servers"] = [f"{ip}:{tunnel.cdn_port or 443}" for ip in tunnel.cdn_ips]
        config["server"] = config["servers"][0]
    sni = tunnel.cdn_host or tunnel.sni
    if tunnel.cdn_host and tunnel.cdn_front:
        # Domain fronting: TLS names another site on the same CDN, the
        # WebSocket Host still names ours, and the CDN routes on the Host.
        sni = tunnel.cdn_front
        config["host"] = tunnel.cdn_host
    if sni:
        config["sni"] = sni
    if tunnel.path:
        config["path"] = tunnel.path
    if tunnel.transport == TunnelTransport.spoof:
        # Foreign side stamps the forged source and binds the tunnel port so
        # the Iran side's spoofed packets reach it; peer is the Iran address.
        config["spoof_source"] = tunnel.spoof_source
        config["listen"] = f"0.0.0.0:{tunnel.iran_port}"
        config["peer"] = f"{tunnel.iran_address}:{tunnel.iran_port}"
        config["pool"] = tunnel.connection_count
    elif tunnel.transport in _MUX_TRANSPORTS:
        config["mux_con"] = tunnel.connection_count
    else:
        config["pool"] = tunnel.connection_count
    return config


def _download_binary_snippet() -> str:
    """A shell prefix that fetches the right-arch prebuilt binary to a temp
    path — the same release install.sh uses — so a spoof test can run on a
    server that doesn't have the tunnel installed yet.
    """
    return (
        'A=$(uname -m); case "$A" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; esac; '
        f'curl -fsSL {_BINARY_RELEASE_URL}/tifusi-tunnel-linux-$A -o /tmp/tifusi-tunnel '
        '&& chmod +x /tmp/tifusi-tunnel'
    )


def build_spooftest_commands(
    foreign_host: str, spoof_ip: str, port: int, seconds: int = 60
) -> tuple[str, str]:
    """The two copy-paste commands that measure whether the Iran server's
    datacenter lets a packet leave with a forged source IP (the L3 filtering
    national-internet mode enforces). The receiver runs on the foreign
    server, the sender on the Iran server; the caller must have already
    validated foreign_host/spoof_ip so neither can inject shell syntax.
    """
    prefix = _download_binary_snippet()
    recv = f"{prefix} && /tmp/tifusi-tunnel spooftest recv --port {port} --seconds {seconds}"
    send = (
        # Raw sockets need root; sudo only when not already root, since minimal
        # servers that log in as root often have no sudo at all.
        f'{prefix} && $([ "$(id -u)" = 0 ] || echo sudo) /tmp/tifusi-tunnel spooftest send '
        f"--to {foreign_host} --port {port} --spoof {spoof_ip}"
    )
    return recv, send


def build_install_command(config: dict) -> str:
    """A single, non-interactive install command for one side of the
    tunnel: install.sh reads its config from this base64 blob (see its
    unattended_install()) instead of dropping into its interactive menu,
    so the admin pastes this once on the right server and nothing else -
    no terminal prompts, no picking transport/token/SNI by hand again.
    """
    encoded = base64.b64encode(json.dumps(config).encode()).decode()
    # No `--` before the config: with `bash <(...)` bash hands it to the script as $1.
    return f"bash <(curl -fsSL {_INSTALL_RAW_URL}) {encoded}"
