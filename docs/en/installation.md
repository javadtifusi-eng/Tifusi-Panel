<sub>[← README](../../README.md) · 📦 **Installation** · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Installation

## Requirements

- **OS:** Ubuntu 22.04/24.04 or Debian 11/12, x86_64, root access and a public IPv4 address.
- **Domain:** recommended for TLS; port 80 must be reachable for Let's Encrypt.

| Role | Minimum | Recommended |
| --- | --- | --- |
| Panel | 1 CPU, 1 GB RAM, 10 GB disk | 2 CPU, 2 GB RAM, 20 GB disk |
| Node | 1 CPU, 512 MB RAM, 10 GB disk | 1 CPU, 1 GB RAM, 20 GB disk |
| Panel and node on one server | 1 CPU, 2 GB RAM, 15 GB disk | 2 CPU, 2 GB RAM, 25 GB disk |
| Panel with MySQL | 2 CPU, 2 GB RAM, 20 GB disk | 2 CPU, 4 GB RAM, 40 GB disk |

## Installing the panel

Choose MySQL for many users.

Install with SQLite:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```

Install with MySQL:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)" -- --pro
```

The installer sets up Docker, the certificate and the `tifusi panel` management command.

The installer asks whether to install a node on the same server; the default is **no**.

## Creating the owner account

1. Open the dashboard; the login page shows the setup flow.
2. Get a one-time key on the panel server:

```bash
tifusi panel key
```

3. Enter the key and create the owner's username and password.

## Next steps

1. [Add a node](nodes.md).
2. [Create a core and a host](cores-and-hosts.md).
3. [Create the first user](users-and-subscriptions.md) and test the connection on a phone.

The dashboard checklist shows these same steps.

## Moving to another server

**Settings → Move to another server** (owner only) moves the panel or a node to a new server over SSH, and customers stay connected throughout.

- **Panel:** data, certificates and settings are copied. Then update the DNS record, and do not press **Finish** until the test turns green. **Revert** brings the previous panel back.
- **Node:** the agent is installed on the new server with the same key. Links handed out with the old IP must be handed out again, so use domains in hosts.
- **The MySQL edition** moves with `tifusi panel backup` and `tifusi panel restore`.

---

<sub>[← README](../../README.md) · [Nodes →](nodes.md)</sub>
