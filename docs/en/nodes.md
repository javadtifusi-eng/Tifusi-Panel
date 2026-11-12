<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 **Nodes** · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Nodes

A node is a server abroad that users connect to directly. The panel only sends the node its configuration; user traffic never passes through the panel.

> Nodes are always installed **outside Iran**. Only the Iran side of a [tunnel](tunnels.md) runs on an Iran server.

## Adding a node

1. **Nodes → New node:** server address and agent port (default `62050`).
2. Run the install command the panel shows on the node, or press **SSH** to let the panel install it (the password is needed only for the first connection and is not stored).
3. Press **Sync**. A green node is ready.
4. On the [Cores](cores-and-hosts.md) page, attach a core to this node.

## Cores on each node

Each node has six independent slots, and any can stay empty:

| Slot | Service |
| --- | --- |
| Xray | VLESS, VMess, Trojan, Shadowsocks and REALITY |
| IKEv2 | Native phone and Windows clients |
| L2TP and PPTP | Legacy clients |
| Hysteria2 | UDP, for weak networks |
| WireGuard | WireGuard clients |

## Managing and updating

- **Terminal:** the **SSH** sheet runs any command on the node, with ready buttons for logs, restart, disk and firewall.
- **Update:** the **Update** tab for one node, or **🔄 Rolling node update** for all. If the new version does not come up, it rolls back automatically. [Safe updates](updates-and-rollback.md)
- **On the server itself:** `tifusi node status|logs|restart|update|uninstall`
- **Removing a node:** first `tifusi node uninstall` on the server, then delete it on the Nodes page.
- **Offline install:** build the bundle with `tifusi panel node-bundle` on the panel server and choose **Offline** in the SSH sheet.

## Replacement node

When a node's IP is blocked or the server changes, users move to the new server without changing their profiles:

1. Add the new server as a node and wait until it is **Connected**.
2. On the old node, open **Replacement node**, choose the target and run **Compatibility check**.
3. Press **Prepare target** and test one user on the new address.
4. Point the DNS record to the new address yourself, then **Confirm move**.

**Revert to previous node** works at any stage. Xray, IKEv2, L2TP and PPTP move; Hysteria2, WireGuard and nodes behind a tunnel do not yet.

## Notes

- **Device limits** are enforced on the node: an extra device waits until a slot frees up.
- **A broken config** is not applied: the node keeps the previous one and the reason shows on the node page.

Technical details: [Architecture](architecture.md#nodes).

---

<sub>[← Installation](installation.md) · [Cores & hosts →](cores-and-hosts.md)</sub>
