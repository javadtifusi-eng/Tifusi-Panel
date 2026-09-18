<sub>[← README](../../README.md) · [Installation](installation.md) · [Nodes](nodes.md) · [Cores & hosts](cores-and-hosts.md) · [Users](users-and-subscriptions.md) · [Resellers](resellers.md) · [Tunnels](tunnels.md) · **Telegram bot** · [Android app](android-app.md) · [Operations](operations.md) · [Deployment](deployment.md) · [Architecture](architecture.md) · [Development](development.md)</sub>

# Tifusi Bot

[Tifusi Bot](https://github.com/javadtifusi-eng/Tifusi-Bot) is a Telegram storefront for selling subscriptions from Tifusi Panel. It creates and renews users through the panel API, so sales need no manual work in the dashboard.

## How it works with the panel

1. The customer picks a service, then a plan, and sends the username they want.
2. The bot takes payment from the customer's wallet, creates the user on the least busy panel and delivers the access code, subscription link and QR code.
3. Renewal always extends the same user on the same panel; the code, link and QR stay unchanged.

The bot offers a service only when the panel has a host for it:

| Service in the bot | Panel protocols |
| --- | --- |
| Xray | VLESS, VMess, Trojan, Shadowsocks |
| Hysteria2 | Hysteria2 |
| IKEv2 | IKEv2 |
| L2TP | L2TP |

A customer who buys one service receives access to that protocol only. Protocols added to or removed from the panel are picked up automatically every five minutes.

## Connecting a panel

In the bot, open **Panel management → Add panel** and enter a name, the panel address and a panel administrator's username and password. The bot tests the connection, reads the panel's protocols and groups, and asks which group each service should use, followed by the location and user capacity. Several panels can be added; when one is full, new purchases move to the next.

## Features

| Area | Description |
| --- | --- |
| Plan store | Plans per service with their own data, duration, price and device limit. |
| Delivery | QR code with subscription link, iPhone profile, access code and IKEv2/L2TP credentials. |
| Wallet | Top-up by payment receipt, approved or rejected by the administrator. |
| Reminders | Automatic messages three days and one day before expiry and on expiry, with a renewal button. |
| Test account | One per user, disabled by default. |
| Broadcast | Text or photo to all users at a rate Telegram accepts. |
| Backup | Instant and daily backups, and restore from inside the bot. |

## Installation

On an Ubuntu 20.04 or later server, as root:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Bot/main/install.sh)
```

The installer asks for the bot token and the administrator's Telegram ID, creates a systemd service and adds the `tifusi bot` menu. On a server that also runs the panel, `tifusi panel` and `tifusi bot` open their own menus from the same launcher.

---

<sub>[← Tunnels](tunnels.md) · [Android app →](android-app.md)</sub>
