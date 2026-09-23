<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="180" alt="Tifusi Panel logo" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<p align="center"><b>Self-hosted control plane for proxy and VPN infrastructure</b></p>

<hr>

<p align="center">
  <a href="https://github.com/javadtifusi-eng/Tifusi-Panel/stargazers"><img src="https://img.shields.io/github/stars/javadtifusi-eng/Tifusi-Panel?style=flat-square&label=stars&color=F97316" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/github/v/tag/javadtifusi-eng/Tifusi-Panel?filter=v*&sort=semver&label=version&style=flat-square&color=22C55E" alt="version" />
  <a href="https://t.me/javadheydeari"><img src="https://img.shields.io/badge/Support-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram support" /></a>
  <img src="https://img.shields.io/github/last-commit/javadtifusi-eng/Tifusi-Panel?label=last%20update&style=flat-square&color=0EA5E9" alt="last update" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-source--available-DC2626?style=flat-square" alt="license" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VLESS-22D3EE?style=flat-square" />
  <img src="https://img.shields.io/badge/VMess-8B5CF6?style=flat-square" />
  <img src="https://img.shields.io/badge/Trojan-EF4444?style=flat-square" />
  <img src="https://img.shields.io/badge/Shadowsocks-F59E0B?style=flat-square" />
  <img src="https://img.shields.io/badge/Hysteria2-10B981?style=flat-square" />
  <img src="https://img.shields.io/badge/WireGuard-6366F1?style=flat-square" />
  <img src="https://img.shields.io/badge/L2TP%2FIPsec-3B82F6?style=flat-square" />
  <img src="https://img.shields.io/badge/IKEv2%2FIPsec-EC4899?style=flat-square" />
</p>

<p align="center">
  <img src="docs/brand/gb.png" height="14" alt="" /> <b>English</b> &nbsp;·&nbsp; <img src="docs/brand/ir.png" height="14" alt="" /> <a href="README.fa.md">فارسی</a> &nbsp;·&nbsp; <img src="docs/brand/ru.png" height="14" alt="" /> <a href="README.ru.md">Русский</a>
</p>

<hr>

Tifusi Panel manages users, access policy and server configuration from one dashboard and pushes it to any number of nodes. Nodes run Xray-core for VLESS, VMess, Trojan and Shadowsocks, and strongSwan with xl2tpd for IKEv2 and L2TP, side by side on the same server.

<p align="center">
  <img src="docs/screenshots/live-dashboard-hosts.svg" width="100%" alt="Tifusi Panel dashboard and hosts" />
  <br /><br />
  <img src="docs/screenshots/live-cores-tunnels.svg" width="100%" alt="Tifusi Panel cores and tunnels" />
</p>

## ✨ Highlights

| | |
| --- | --- |
| ⚡ **Two cores on one node** | Each node runs an Xray core and an IPsec core (IKEv2 or L2TP) at the same time, so one server serves proxy and native-VPN clients together. |
| 🔒 **Device limits on the node** | Simultaneous connections are enforced by the node itself for Xray, IKEv2 and L2TP, not only counted by the panel. |
| 💼 **Resellers** | Separate sign-ins with their own protocols, user limit and data quota, and no view of the servers. |
| 🚇 **Tunnels** | Publish a server abroad through a relay inside a restricted network, with install commands generated for both sides. |
| 🛡️ **Connection Shield** | When an Iran relay loses international access, users move to a standby relay within about two minutes — through a Cloudflare DNS record, with nothing to update on their side. |
| 📶 **Network health** | The dashboard shows connection success per operator and protocol, and warns when one operator starts failing or blocks the subscription domain. |
| ✈️ **Telegram bot and Android app** | Sell subscriptions automatically with Tifusi Bot and connect in one tap with Tifusi VPN. |

## 🚀 Quick start

**Panel**

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```

Add `-- --pro` for the professional edition with MySQL. Requirements, first-run setup and editions are described in [Installation](docs/en/installation.md).

**Node** — create the node on the **Nodes** page, then run on the node server:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
```

## 📚 Documentation

| Section | Contents |
| --- | --- |
| 📦 [Installation](docs/en/installation.md) | Server requirements, standard and professional editions, first-run setup |
| 🌐 [Nodes](docs/en/nodes.md) | Two cores on one node, adding and removing nodes, synchronisation, device limits |
| 🚀 [Hysteria2](docs/en/hysteria2.md) | A UDP transport for networks where TCP protocols are poor (mobile operators in Iran): setup, per-user passwords, usage counting, disconnecting |
| 🔐 WireGuard | Its own core on UDP 4500 beside IKEv2; per-user keys, a `wireguard://` link and a `.conf`/QR for the official app |
| 🛟 Backup domains | Spare subscription domains the Tifusi app falls over to when the live one is filtered (Settings) |
| ⚛️ [Cores, hosts and groups](docs/en/cores-and-hosts.md) | Xray, IKEv2 and L2TP cores, public endpoints, REALITY scanner (real per-fingerprint test, filter check from inside Iran), access groups |
| 👤 [Users and subscriptions](docs/en/users-and-subscriptions.md) | Quotas, expiry, on-hold accounts, subscription links, access codes, client profiles |
| 💼 [Resellers](docs/en/resellers.md) | Reseller accounts, allowed protocols, user limits and data quotas |
| 🚇 [Tunnels](docs/en/tunnels.md) | Relaying a foreign server, transports, forwarded ports, testing and spoof test |
| 🛡️ [Connection Shield](docs/en/connection-shield.md) | Standby Iran relays and automatic failover through Cloudflare DNS or host addresses when a relay loses international access |
| ✈️ [Telegram bot](docs/en/telegram-bot.md) | Tifusi Bot: automatic sales, renewals and wallet through the panel API |
| 📱 [Android app](docs/en/android-app.md) | Tifusi VPN: importing servers by access code, one-tap IKEv2, connection reports |
| 📶 [Network health](docs/en/network-health.md) | Connection success per operator (MCI, Irancell, TCI…) and per protocol on the dashboard, with block alerts |
| 🎛️ [Operations](docs/en/operations.md) | `tifusi panel` commands, administrators, API keys, notifications, settings |
| 🚢 [Deployment reference](docs/en/deployment.md) | Docker Compose, ports, TLS, database migrations |
| 📐 [Architecture](docs/en/architecture.md) | Components, data flow, node synchronisation, repository layout |
| 💻 [Development](docs/en/development.md) | Running the backend, dashboard and node agent from source |

Release notes are in [CHANGELOG.md](CHANGELOG.md) and planned work in [ROADMAP.md](ROADMAP.md).

## 📄 License

Tifusi Panel is **source-available, not open source**. You may read the code, install the unmodified panel and run it for your own servers and services. Copying any part of the code, modifying and republishing it, rebranding it or selling it requires written permission. See [LICENSE](LICENSE).

<sub>The emblem is carried over from the Tifusi-Tunnel project.</sub>
