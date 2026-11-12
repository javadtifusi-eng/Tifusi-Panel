<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 **Safe updates** · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Safe updates

Every update is tested before it is applied, and the previous version is kept. If the new version does not come up, it rolls back automatically.

## Updating the panel

On the panel server:

```bash
tifusi panel update
```

Images and the database are snapshotted first. If the new panel is not healthy within 90 seconds, the previous version returns. Take a [backup](operations.md) before major updates as well.

## Updating nodes

- **One node:** the node's **SSH** sheet → **Update** tab.
- **All nodes:** Nodes page → **🔄 Rolling node update**. The first node (canary) is watched longer, and the run stops at the first failure.

The node tests the new image first and reverts to the previous one if the agent, or any service that was healthy, does not come back. Users on each node drop for a few seconds and reconnect automatically.

## Updating tunnels

The tunnel's **SSH** sheet → **🔄 Update tunnel** for each side. If the service does not stay up or links do not return within 45 seconds, the previous binary returns. The tunnel config is never changed.

## Node configuration

Every user or core change sends a new config to the node. A broken config is not applied; the node keeps the previous one and the reason shows on the node page.

## Reserved ports

A core that uses these ports is not saved:

| Port | Used by |
| --- | --- |
| 62050 (or the node's agent port) | Node agent |
| 22 | SSH |
| 10085, 10087, 9998 | Xray, WireGuard and Hysteria2 stats APIs |

## Telegram report

The end of every panel, node or tunnel update, with its result and duration, is reported to the chat set in **Settings → Telegram notifications**.

Technical details: [Architecture](architecture.md#safe-updates).

---

<sub>[← Operations](operations.md) · [Deployment →](deployment.md)</sub>
