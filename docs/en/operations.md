<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ **Operations** · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Operations

## Management command

`tifusi panel` with no argument opens a menu:

| Command | Action |
| --- | --- |
| `update` | Update with automatic rollback |
| `status` / `logs` / `restart` | Status, logs and restart |
| `port` / `ssl` | Change ports, Let's Encrypt certificate |
| `key` | New sign-in key for an admin |
| `backup` / `restore` | Backup and restore |
| `node-bundle` | Build the offline node bundle |
| `remove-node` | Remove a node from this panel |
| `path` | Secret dashboard path |
| `env` | Edit the settings file (`.env`) |
| `uninstall` | Uninstall |

`tifusi bot` opens the [bot](telegram-bot.md) menu and `tifusi node` the [node](nodes.md) menu.

## Backups

```bash
tifusi panel backup
```

The archive holds the database (and MySQL), `.env` and certificates. Keep it private and keep a copy off the server. In the standard edition, **Settings** also has database backup and restore buttons. Take a fresh backup before restoring.

## Admins

- The **owner** can do everything. A **limited admin** sees only the sections they are allowed, and only users they created.
- Every admin can create **API keys**; changing the password revokes them.
- [Resellers](resellers.md) are a separate, more limited account type.

## Sign-in

- **Password** with optional **two-factor code**.
- **Google or GitHub:** the owner enters the Client ID and Secret once in **Settings → Sign in with Google and GitHub**; each admin then links their own account.
- **Remember me** keeps the session for up to 30 days. **Sign out everywhere** revokes every session.

## Notifications and settings

- User and node state changes, and the end of every update, go to Telegram, Discord or a webhook.
- Public address, password, TLS certificate and backups change from **Settings** without reinstalling.

---

<sub>[← Network health](network-health.md) · [Safe updates →](updates-and-rollback.md)</sub>
