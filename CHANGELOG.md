# Changelog

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
