<sub>[← README](../../README.md) · 🚀 [Installation](installation.md) · 🖥️ **Nodes** · 🧩 [Cores & hosts](cores-and-hosts.md) · 👥 [Users](users-and-subscriptions.md) · 🤝 [Resellers](resellers.md) · 🌉 [Tunnels](tunnels.md) · 🤖 [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · ⚙️ [Operations](operations.md) · 🐳 [Deployment](deployment.md) · 🏗️ [Architecture](architecture.md) · 🛠️ [Development](development.md)</sub>

# Nodes

A node is a server that carries user traffic. The panel renders each node's configuration and pushes it to the node agent over HTTPS; clients connect to the node directly and the panel never proxies their traffic.

## Two cores on one node

Every node has two independent core slots and runs both at the same time:

| Slot | Core type | Serves |
| --- | --- | --- |
| Xray | `xray` | VLESS, VMess, Trojan, Shadowsocks |
| IPsec | `ikev2` or `l2tp` | Native IKEv2/IPsec or L2TP/IPsec clients |

One server therefore serves proxy clients and native-VPN clients together. Panels that bind a single core to each node need a second server for the same result. Either slot may be left empty.

## Adding a node

1. On the **Nodes** page, create the node with its address, agent port and the cores for its two slots. The panel generates an API key bound to the node.
2. Run the install command shown for the node on the node server:
   ```bash
   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
   ```
   `PORT` defaults to `62050`. The script pulls the prebuilt node image (or builds it locally if unavailable), loads the required kernel modules and starts the `tifusi-node` container on the host network.
3. Select **Sync** in the panel to push the initial configuration. After the first successful sync, health checks and traffic collection run continuously.

## Managing a node server

The installer adds `tifusi node`, the node server's own menu, with `status`, `logs`, `restart` and `uninstall`, either interactively or as `tifusi node <action>`.

Removing a node takes two steps, because the panel never reaches into a node server to stop anything:

1. `tifusi node uninstall` on the node removes the agent.
2. **Remove a node from this panel** in `tifusi panel`, or the **Nodes** page, makes the panel forget it.

## Synchronisation

Any change that affects a node (a user created, renewed, limited or deleted, a core edited, a group changed) is resolved into the node's effective user set and pushed as two payloads: the rendered Xray JSON to `POST /config` and the IPsec connections, EAP secrets, PSK and address pools to `POST /ipsec-config`. Every `TIFUSI_TRAFFIC_SYNC_INTERVAL_SECONDS` (30 by default) the panel polls `GET /health` and `GET /stats`, accumulates per-user traffic, moves users to `expired` or `limited` when due, and resyncs nodes whose user set changed. The full sequence is drawn in [Architecture](architecture.md#node-synchronisation-lifecycle).

## Device limits on the node

The per-user device limit is enforced on the node as simultaneous connections for Xray, IKEv2 (EAP) and L2TP. Devices already connected stay connected and one more waits until a place frees up. For Xray a device is a client IP, and the check matches the user as well as the IP, so customers sharing a carrier IP do not affect each other.

## Transport security

- The agent serves HTTPS with a self-signed certificate generated on first start (`backend/node_agent/tls.py`), which encrypts credentials and pushed secrets in transit.
- Every request carries the per-node key in the `X-Node-Api-Key` header. The panel does not verify the agent certificate, so the API key is the effective credential; mutual TLS is not yet implemented.
- The node container uses `--network host` so that Xray can bind ports defined after the container starts, and so that UDP 500, 4500 and 1701 reach charon and xl2tpd on the public address.

---

<sub>[← Installation](installation.md) · [Cores & hosts →](cores-and-hosts.md)</sub>
