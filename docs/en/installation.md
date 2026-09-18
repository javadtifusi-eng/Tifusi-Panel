<sub>[← README](../../README.md) · 📦 **Installation** · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Installation

## Requirements

### Server sizing

| Role | Minimum | Recommended |
| --- | --- | --- |
| Panel | 1 vCPU, 1 GB RAM, 10 GB disk | 2 vCPU, 2 GB RAM, 20 GB disk |
| Node | 1 vCPU, 512 MB RAM, 10 GB disk | 1 vCPU, 1 GB RAM, 20 GB disk |
| Panel and node on one server | 1 vCPU, 2 GB RAM, 15 GB disk | 2 vCPU, 2 GB RAM, 25 GB disk |
| Panel, professional edition (MySQL) | 2 vCPU, 2 GB RAM, 20 GB disk | 2 vCPU, 4 GB RAM, 40 GB disk |

Measured on a running installation: the panel container uses about 100 MB of RAM, the dashboard about 6 MB and a node about 50 MB; the images take about 1 GB of disk. The larger recommended disk leaves room for image updates, logs and backups. Traffic volume, not user count, is what drives node CPU and bandwidth needs.

### Platform

- OS: Ubuntu 22.04/24.04 or Debian 11/12 (the installers use `apt-get`). Other Linux distributions work with Docker installed manually.
- Architecture: x86_64 (amd64). Prebuilt images are published for amd64 only; other architectures build locally, which takes considerably longer.
- Root access and a public IPv4 address.

### Network

- Panel: a DNS record pointing to the server is recommended for TLS. Port 80 must be reachable to issue a free Let's Encrypt certificate.
- Node: IKEv2 requires UDP 500 and 4500; L2TP additionally requires UDP 1701 and the `l2tp_ppp` and `ppp_generic` kernel modules on the host.
- Building images locally requires outbound access to GitHub releases for Xray-core and to the strongSwan source archive.

## Panel — standard edition (SQLite)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```

The installer provisions Docker, clones the repository, generates `TIFUSI_SECRET_KEY`, optionally issues a Let's Encrypt certificate for a domain that resolves to the server, and starts the stack with Docker Compose. It also installs the `tifusi panel` management command.

## Panel — professional edition (MySQL)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)" -- --pro
```

The same panel with every record (users, nodes, hosts, groups, cores and settings) stored in a bundled MySQL 8.4 container instead of the built-in SQLite file. The installer generates the MySQL passwords, keeps MySQL reachable only on the internal Docker network and stores its data in `mysql-data/`. Choose it for large user bases or when you want a standard database server to manage and back up; `tifusi panel backup` and `tifusi panel restore` include a MySQL dump. Nodes are installed the same way for both editions.

## First-run setup

1. Open the dashboard. When no administrator exists, the sign-in screen offers the setup procedure.
2. Generate a one-time setup key on the panel server:
   ```bash
   docker exec -it tifusi-panel tifusi-cli generate-admin-key
   ```
   `tifusi panel key` does the same from the management menu.
3. Enter the key, then choose the owner username and password.

---

<sub>[← README](../../README.md) · [Nodes →](nodes.md)</sub>
