<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 **Nodes** · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · 🔀 [Domain rotation](domain-rotation.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Nodes

A node is a server that carries user traffic. The panel renders each node's configuration and pushes it to the node agent over HTTPS; clients connect to the node directly and the panel never proxies their traffic.

## Two cores on one node

Every node has two independent core slots and runs both at the same time:

| Slot | Core type | Serves |
| --- | --- | --- |
| Xray | `xray` | VLESS, VMess, Trojan, Shadowsocks |
| IPsec | `ikev2` or `l2tp` | Native IKEv2/IPsec or L2TP/IPsec clients |
| L2TP | `l2tp` | L2TP/IPsec clients beside an IKEv2 core in the IPsec slot |

With IKEv2 in the IPsec slot and an L2TP core in the L2TP slot, one server serves both at once: strongSwan loads the two connections side by side and xl2tpd runs next to it. That covers new Android phones, which dropped L2TP in Android 12 and only have IKEv2, and older phones, iPhones and Windows on L2TP. On the **Cores** page, tick the node on the L2TP core's card. One server therefore serves proxy clients and native-VPN clients together. Panels that bind a single core to each node need a second server for the same result. Either slot may be left empty.

## Adding a node

1. On the **Nodes** page, create the node with its address, agent port and the cores for its two slots. The panel generates an API key bound to the node.
2. Run the install command shown for the node on the node server:
   ```bash
   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
   ```
   `PORT` defaults to `62050`. The script pulls the prebuilt node image (or builds it locally if unavailable), loads the required kernel modules, turns on BBR congestion control with larger network buffers (`/etc/sysctl.d/99-tifusi-network.conf`) for better throughput on long, lossy links, and starts the `tifusi-node` container on the host network.
3. Select **Sync** in the panel to push the initial configuration. After the first successful sync, health checks and traffic collection run continuously.

## Install over SSH (from the panel)

Next to the copy-paste command, the node's **SSH** button lets the panel do the install itself. It is an extra option: the manual command above keeps working exactly as before.

1. Enter the server's SSH user and port and, for the first connection only, its password or a private key. Leave **Install the panel's key** ticked: the panel adds its own key (`data/ssh/id_ed25519`, created on first use) to the server's `authorized_keys`, and every later connection uses that key. Your password or key is never stored.
2. Choose **Offline (bundle)** or **Online (GitHub)** and press **Start install**. Online runs the same one-line installer on the server. Offline uploads the bundle described below over SFTP (skipped when the same file is already there, checked by SHA-256) and runs it. The installer's output streams into the sheet, and the panel syncs the node when it finishes.
3. The server's host key is pinned on the first connection and checked before any credential is sent on later ones. If the server is reinstalled, use **Forget** next to the fingerprint.

The **Terminal** tab runs any command on the node's server (as root, or through passwordless `sudo` for another user), with output and exit code, plus ready-made buttons for node status, logs, restart, disk and memory, firewall and ports. SSH on nodes is open to the panel owner only, and every command is logged with the admin who ran it.

## Updating the node agent

A node's **SSH** sheet has an **Update** tab, and the Nodes page a **🔄 Rolling node update** for several nodes at once, canary first. The node self-tests the new image, keeps the running one as `tifusi-node-agent:rollback`, and puts it back by itself if the new agent doesn't answer; the panel then pushes the config again, checks every service that was healthy is still healthy, and watches the node for a soak period before moving to the next one. Details in [Safe updates](updates-and-rollback.md#updating-node-agents-canary-rollout). `tifusi node update` on the node server still works as before.

## Offline install bundle

For a server that can reach neither GitHub, ghcr.io, Docker Hub nor an apt mirror (an Iranian server during an international shutdown), build the offline bundle on the panel server, which still has open internet:

```bash
tifusi panel node-bundle
```

It writes `data/node-bundle/tifusi-node-offline.tar` with the node image (`docker save`), Docker's static binaries (installed with their own systemd unit on a server without Docker, any distro), `iptables`/`kmod`/`iproute2` packages for Ubuntu 22.04/24.04 and Debian 12 (used only when the server lacks them), both tunnel binaries, the `tifusi node` command and a `SHA256SUMS` file the installer checks first. Rebuild it after updating the panel so nodes get the new image.

Use it from the node's **SSH** sheet (offline method), or download it there and copy it over the domestic network yourself:

```bash
scp tifusi-node-offline.tar root@NODE:/root/
ssh root@NODE 'cd /root && tar xf tifusi-node-offline.tar && cd tifusi-node-offline && bash install-node.sh <API_KEY> [PORT]'
```

`install-node.sh` switches to offline mode only when it runs from an unpacked bundle (or `TIFUSI_OFFLINE_DIR` points at one); the usual `curl` one-liner is unchanged. In offline mode it also opens the agent port when ufw is active. Keep a copy of the bundle on the Iranian server before a shutdown begins.

## Managing a node server

The installer adds `tifusi node`, the node server's own menu, with `status`, `logs`, `restart` and `uninstall`, either interactively or as `tifusi node <action>`.

Removing a node takes two steps, because the panel never reaches into a node server to stop anything:

1. `tifusi node uninstall` on the node removes the agent.
2. **Remove a node from this panel** in `tifusi panel`, or the **Nodes** page, makes the panel forget it.

## Synchronisation

Any change that affects a node (a user created, renewed, limited or deleted, a core edited, a group changed) is resolved into the node's effective user set and pushed as two payloads: the rendered Xray JSON to `POST /config` and the IPsec connections, EAP secrets, PSK and address pools to `POST /ipsec-config`. Every `TIFUSI_TRAFFIC_SYNC_INTERVAL_SECONDS` (30 by default) the panel polls `GET /health` and `GET /stats`, accumulates per-user traffic, moves users to `expired` or `limited` when due, and resyncs nodes whose user set changed. The full sequence is drawn in [Architecture](architecture.md#node-synchronisation-lifecycle).

Each push is applied safely: the agent checks a new Xray config with `xray run -test` before touching the running process, keeps the last config that ran, and puts it back if a service dies on a new one (Xray, WireGuard, Hysteria2, strongSwan, xl2tpd, pptpd). A refused config is shown on the node with the reason, and the node stays connected on its previous config. See [Safe updates](updates-and-rollback.md#config-pushes-on-a-node).

## Device limits on the node

The per-user device limit is enforced on the node as simultaneous connections for Xray, IKEv2 (EAP) and L2TP. Devices already connected stay connected and one more waits until a place frees up. For Xray a device is a client IP, and the check matches the user as well as the IP, so customers sharing a carrier IP do not affect each other.

## Transport security

- The agent serves HTTPS with a self-signed certificate generated on first start (`backend/node_agent/tls.py`), which encrypts credentials and pushed secrets in transit.
- Every request carries the per-node key in the `X-Node-Api-Key` header. The panel does not verify the agent certificate, so the API key is the effective credential; mutual TLS is not yet implemented.
- The node container uses `--network host` so that Xray can bind ports defined after the container starts, and so that UDP 500, 4500 and 1701 reach charon and xl2tpd on the public address.

---

<sub>[← Installation](installation.md) · [Cores & hosts →](cores-and-hosts.md)</sub>
