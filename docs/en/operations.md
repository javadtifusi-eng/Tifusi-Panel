<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · 🔀 [Domain rotation](domain-rotation.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ **Operations** · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

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

`tifusi` is a launcher shared with [Tifusi Bot](telegram-bot.md): `tifusi bot` opens the bot installer menu. When only one of the panel and the bot is installed on a server, `tifusi` without a subcommand opens that component, so `tifusi update` continues to work.

Node servers have their own `tifusi node` menu; see [Nodes](nodes.md#managing-a-node-server).

## Updates without downtime surprises

Node agents and tunnel binaries can be updated from the panel with automatic rollback — node agents one at a time with a canary, tunnels side by side — and every config push to a node is validated before it replaces the running one. How each layer checks and rolls back is described in [Safe updates](updates-and-rollback.md).

## Administrators

The panel has one owner account and any number of additional administrators with scoped permissions over users, hosts, nodes, cores, groups, tunnels and settings. A scoped administrator sees only the users it created. Every administrator can issue API keys for automation; a key always carries its owner's current permissions. Changing your password revokes all your API keys unless you untick **Revoke all my API keys** (API clients: send `"revoke_api_keys": false`). [Resellers](resellers.md) are a separate, more restricted kind of account.

## Signing in

Besides the password (with optional two-factor codes from an authenticator app), an administrator can sign in with **Google** or **GitHub**:

- **Owner, once:** register an OAuth app with the provider for this panel's own address and enter its Client ID and Client Secret under **Settings → Sign in with Google and GitHub**. The section shows the exact callback address to register (`https://<panel>/api/auth/oauth/google/callback`, or `/github/callback`). The secret stays on the server and is never shown again; leaving both providers empty keeps the login page as it was.
- **Each administrator:** links their own account from the same section, confirming with the current panel password. From then on the button on the login page signs them in. Only linked accounts get in: a Google or GitHub account nobody linked is refused, and one account opens at most one administrator. Two-factor login, when on, is still asked for after the provider.
- **Remember me** on the login page keeps that browser signed in for 30 days instead of one day; unticked, the session also ends when the browser closes.
- **Sign out of all devices** ends every session of that administrator at once, remembered ones included. A password change does the same and also unlinks their Google and GitHub accounts (someone who knew the old password could have linked one of their own); link them again afterwards.

The password always keeps working, so losing access to Google or GitHub never locks anyone out.

## Notifications

User and node state changes, [Connection Shield](connection-shield.md) events and [domain rotation](domain-rotation.md) burns and recoveries can be sent to Telegram, Discord or a generic webhook. Shield events arrive at the webhook as `shield_burnt`, `shield_switched`, `shield_no_spare`, `shield_recovered` and `shield_error`. After every panel, node or tunnel update, Telegram also gets a [short update report](updates-and-rollback.md#update-report-on-telegram).

## Settings

The public URL, administrator password, TLS certificate (upload or Let's Encrypt issuance) and database backup and restore are all changed from **Settings** and take effect without redeployment. The Settings backup covers the standard edition; for the professional edition use `tifusi panel backup`, which includes a MySQL dump.

---

<sub>[← Network health](network-health.md) · [Safe updates →](updates-and-rollback.md)</sub>
