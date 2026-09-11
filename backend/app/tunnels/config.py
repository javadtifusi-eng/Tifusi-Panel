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

_MUX_TRANSPORTS = {TunnelTransport.tcpmux, TunnelTransport.wsmux, TunnelTransport.wssmux}


def build_iran_config(tunnel: Tunnel) -> dict:
    config: dict = {
        "mode": "server",
        "listen": f"0.0.0.0:{tunnel.iran_port}",
        "transport": tunnel.transport.value,
        "token": tunnel.token,
    }
    if tunnel.sni:
        config["sni"] = tunnel.sni
    if tunnel.path:
        config["path"] = tunnel.path
    if tunnel.domain:
        config["domain"] = tunnel.domain
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
    config: dict = {
        "mode": "client",
        "server": f"{tunnel.iran_address}:{tunnel.iran_port}",
        "transport": tunnel.transport.value,
        "token": tunnel.token,
    }
    if tunnel.sni:
        config["sni"] = tunnel.sni
    if tunnel.path:
        config["path"] = tunnel.path
    if tunnel.transport in _MUX_TRANSPORTS:
        config["mux_con"] = tunnel.connection_count
    else:
        config["pool"] = tunnel.connection_count
    return config


def build_install_command(config: dict) -> str:
    """A single, non-interactive install command for one side of the
    tunnel: install.sh reads its config from this base64 blob (see its
    unattended_install()) instead of dropping into its interactive menu,
    so the admin pastes this once on the right server and nothing else -
    no terminal prompts, no picking transport/token/SNI by hand again.
    """
    encoded = base64.b64encode(json.dumps(config).encode()).decode()
    return f"bash <(curl -fsSL {_INSTALL_RAW_URL}) -- {encoded}"
