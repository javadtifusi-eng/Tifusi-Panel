<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 📶 [Network health](network-health.md) · 🎛️ **Operations** · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Operations

## Management command

`tifusi panel` runs an interactive menu, or a single action when given an argument:

| Command | Action |
| --- | --- |
| `tifusi panel update` | Update to the latest release and recreate the containers |
| `tifusi panel status` | Show container state |
| `tifusi panel logs` | Follow container logs |
| `tifusi panel restart` | Restart the stack |
| `tifusi panel port` | Change the panel API and dashboard ports |
| `tifusi panel ssl` | Issue a Let's Encrypt certificate |
| `tifusi panel key` | Generate a new administrator setup key |
| `tifusi panel backup` / `tifusi panel restore` | Export or restore the database |
| `tifusi panel uninstall` | Remove the installation |

`tifusi` is a launcher shared with [Tifusi Bot](telegram-bot.md): `tifusi bot` opens the bot installer menu and `tifusi app` prints the latest [Tifusi VPN](android-app.md) release with its download link. When only one of the panel and the bot is installed on a server, `tifusi` without a subcommand opens that component, so `tifusi update` continues to work.

Node servers have their own `tifusi node` menu; see [Nodes](nodes.md#managing-a-node-server).

## Administrators

The panel has one owner account and any number of additional administrators with scoped permissions over users, hosts, nodes, cores, groups, tunnels and settings. A scoped administrator sees only the users it created. Every administrator can issue API keys for automation; a key always carries its owner's current permissions. [Resellers](resellers.md) are a separate, more restricted kind of account.

## Notifications

User and node state changes, and [Connection Shield](connection-shield.md) events, can be sent to Telegram, Discord or a generic webhook. Shield events arrive at the webhook as `shield_burnt`, `shield_switched`, `shield_no_spare`, `shield_recovered` and `shield_error`.

## Settings

The public URL, administrator password, TLS certificate (upload or Let's Encrypt issuance) and database backup and restore are all changed from **Settings** and take effect without redeployment. The Settings backup covers the standard edition; for the professional edition use `tifusi panel backup`, which includes a MySQL dump.

---

<sub>[← Network health](network-health.md) · [Deployment →](deployment.md)</sub>
