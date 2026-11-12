<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ **Cores & hosts** · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Cores and hosts

A **core** is a service that runs on a node. A **host** is the link a user receives. A **group** decides which hosts each user sees.

## Creating a core

1. **Cores → New core** and choose the type: Xray, IKEv2, L2TP, PPTP, Hysteria2 or WireGuard.
2. For Xray, paste the JSON config (the same one `xray run -c` accepts). Inbounds are extracted automatically. REALITY settings go here too.
3. On the core card, pick the nodes that should run it.

A core on a [reserved port](updates-and-rollback.md) is not saved.

## Creating a host

1. **Hosts → New host:** protocol, inbound (or the core for IKEv2 and L2TP), address, port and display name.
2. If needed, override SNI, fingerprint, path and ALPN for clients.

Several hosts on one inbound are variants of the same link and are grouped into one card.

### Host name variables

The `{ }` button in the name field inserts a variable, for example `🇩🇪 {server_name} | {days_left} days`.

| Variable | Value |
| --- | --- |
| `{username}` | User name |
| `{days_left}` | Days remaining |
| `{expiry_date_en}` / `{expiry_date_fa}` | Expiry date, Gregorian / Jalali |
| `{remaining_traffic}` / `{used_traffic}` / `{total_traffic}` | Traffic |
| `{server_name}` / `{protocol}` / `{status}` | Server, protocol, status |

## Hysteria2

A UDP core that runs beside Xray, for networks where TCP protocols perform poorly. Each user's password is their subscription secret.

**Setup**

1. **Cores → Hysteria2 → New core:** UDP port, obfuscation password (salamander) and rate cap (empty means none; 15 Mbps worked best on MCI).
2. On the core card, pick the node. The node agent runs the Hysteria2 server itself.
3. **Hosts → New host** with the Hysteria2 protocol on that core. Address and SNI must match the node's TLS certificate.

**Choosing the port** (measured on MCI mobile; only the port changed)

| UDP port | Result |
| --- | --- |
| 443 | fully blocked |
| 53 | about 3 Mbps down |
| 1194, 51820 | good volume, poor latency |
| **8801** (Zoom) | **40 Mbps down, 3.5 Mbps up** |

If 8801 is throttled, try 3478 and 19302 next.

**Limits**

- One Hysteria2 core per node.
- For now only on the node on the panel's own machine, since it uses the panel certificate (`/opt/tifusi-panel/certs`).
- Without obfuscation it does not connect from Iran.
- Usage is counted, and expired or disabled users are disconnected.

## Groups

- A host or inbound **without a group** is for every user.
- A host **with groups** goes only to members of those groups.
- To try a new link (another port, a clean IP) on a few users, give that host its own group (🔒).

---

<sub>[← Nodes](nodes.md) · [Users & subscriptions →](users-and-subscriptions.md)</sub>
