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

_MUX_TRANSPORTS = {TunnelTransport.tcpmux, TunnelTransport.tcpstealth, TunnelTransport.wsmux, TunnelTransport.wssmux}


def build_iran_config(tunnel: Tunnel, foreign_host: str | None = None) -> dict:
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
        config["spoof_carrier"] = tunnel.spoof_carrier or "udp"
        # The Iran side sends Iran -> foreign and hears back on the return one.
        if tunnel.spoof_carrier_back and tunnel.spoof_carrier_back != config["spoof_carrier"]:
            config["spoof_recv_carrier"] = tunnel.spoof_carrier_back
        if tunnel.spoof_stealth:
            # Both ends share one forged source in the panel, so the pin the
            # far side must match is simply that same address.
            config["spoof_stealth"] = True
            config["spoof_peer_src"] = tunnel.spoof_source
        if tunnel.foreign_address:
            config["peer"] = f"{tunnel.foreign_address}:{tunnel.iran_port}"
    if tunnel.transport == TunnelTransport.udp:
        # UDP forwards cross the raw relay (tunnel port + 1), not KCP.
        config["udp_raw"] = True
    config["forwards"] = [
        {
            "name": f["name"],
            "listen": f"0.0.0.0:{f['listen_port']}",
            "net": f["net"],
            "target": f"{_forward_target_host(f, foreign_host)}:{f['target_port']}",
            # Only when on, so a forward without it keeps its exact old config.
            **({"proxy_protocol": True} if f.get("proxy_protocol") and f["net"] == "tcp" else {}),
        }
        for f in tunnel.forwards
    ]
    return config


_IKE_PORTS = {500, 4500}


def _forward_target_host(forward: dict, foreign_host: str | None) -> str:
    # IKEv2 must not be delivered to loopback: charon would see the client as
    # 127.0.0.2, and the kernel never sends the ESP replies of a forwarded
    # packet to a 127/8 address, so the phone connects but gets no traffic.
    if forward["net"] == "udp" and int(forward["target_port"]) in _IKE_PORTS and foreign_host:
        return foreign_host
    return "127.0.0.1"


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
        config["spoof_carrier"] = tunnel.spoof_carrier or "udp"
        # The foreign side is the mirror image: it sends on the return carrier.
        if tunnel.spoof_carrier_back and tunnel.spoof_carrier_back != config["spoof_carrier"]:
            config["spoof_recv_carrier"] = config["spoof_carrier"]
            config["spoof_carrier"] = tunnel.spoof_carrier_back
        if tunnel.spoof_stealth:
            config["spoof_stealth"] = True
            config["spoof_peer_src"] = tunnel.spoof_source
        config["listen"] = f"0.0.0.0:{tunnel.iran_port}"
        config["peer"] = f"{tunnel.iran_address}:{tunnel.iran_port}"
        config["pool"] = tunnel.connection_count
    elif tunnel.transport in _MUX_TRANSPORTS:
        config["mux_con"] = tunnel.connection_count
    else:
        config["pool"] = tunnel.connection_count
    if tunnel.transport == TunnelTransport.udp:
        config["udp_raw"] = True
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
    foreign_host: str,
    spoof_ip: str,
    port: int,
    seconds: int = 60,
    protocol: str = "udp",
    max_loss: int = 100,
) -> tuple[str, str]:
    """The two copy-paste commands that measure whether the Iran server's
    datacenter lets a packet leave with a forged source IP (the L3 filtering
    national-internet mode enforces). The receiver runs on the foreign
    server, the sender on the Iran server; the caller must have already
    validated foreign_host/spoof_ip so neither can inject shell syntax.
    """
    prefix = _download_binary_snippet()
    # Flags only when not the default, so the commands stay what they were for
    # a plain UDP test.
    proto = f" --proto {protocol}" if protocol != "udp" else ""
    loss = f" --max-loss {max_loss}" if max_loss < 100 else ""
    # ICMP and TCP probes are read off a raw socket, which needs root too.
    recv_sudo = '$([ "$(id -u)" = 0 ] || echo sudo) ' if protocol != "udp" else ""
    recv = f"{prefix} && {recv_sudo}/tmp/tifusi-tunnel spooftest recv --port {port} --seconds {seconds}{proto}{loss}"
    send = (
        # Raw sockets need root; sudo only when not already root, since minimal
        # servers that log in as root often have no sudo at all.
        f'{prefix} && $([ "$(id -u)" = 0 ] || echo sudo) /tmp/tifusi-tunnel spooftest send '
        f"--to {foreign_host} --port {port} --spoof {spoof_ip}{proto}"
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
