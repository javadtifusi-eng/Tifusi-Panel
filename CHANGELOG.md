# Changelog

## v1.0.4 — 2026-11-18

- Security: TLS private keys are written readable by root only, on install, on renewal and for subscription domains; the update also tightens keys left by older versions.
- Safer updates: the database snapshot is verified before anything changes, and a failed update rolls back. The health check now covers the dashboard too.
- Nodes: the services card shows one row per core (WireGuard and Hysteria included; PPTP no longer under IPsec).
- Settings: the bot token and webhook secret are hidden by default, with a show button.
- Cores: inbound, outbound, routing and balancer editors on par with the reference panels; DNS and API tabs; JSON diff against the last save; outbound latency test from the nodes.
- Look: one glass button system with icons, Inter for Latin text, a Cores sub-menu in the sidebar, simpler nodes page, new logo.
- Moving the panel onto one of its own nodes.

## v1.0.3 — 2026-11-13

- Xray core form in tabs: inbounds, outbounds, routing, balancers, JSON.
- WireGuard outbounds, imported from a WireGuard client file.
- WARP: a free Cloudflare WARP account as an outbound in one click (IPv6, IPv4 or both).
- Routing rules as blocks: site, IP, inbound, user, port and network conditions.
- IKEv2 and L2TP routing: chosen destinations (IP ranges or an AS number) leave through a WireGuard outbound. Needs the node update in this release.
- The inbound builder's quick-start presets are removed.

## v1.0.2 — 2026-11-13

- Smaller downloads: the node image is about 93 MB smaller and the panel image about 59 MB smaller.
- Moving the panel is safer: a dropped SSH session can no longer leave two panels running, the moved data is deleted from the new server once unpacked, and a restart mid-move no longer leaves the panel frozen.
- SSH jobs: Cancel now stops the work on the server, uploads no longer use fixed names in /tmp, and very long output keeps its final result and stays light on phones.

## v1.0.1 — 2026-11-13

First official release of Tifusi Panel. Earlier test versions are retired; numbering starts fresh from 1.0.1.

- Protocols: IKEv2, L2TP and Xray (VLESS REALITY, VMess, Trojan) on one panel, with nodes managed from the dashboard.
- Nodes and tunnels: install, update and replace over SSH, with offline bundles and automatic rollback.
- Users: subscriptions, traffic and expiry limits, resellers, and the Tifusi Bot integration.
- Dashboard: live server status, notifications, and English digits throughout.
