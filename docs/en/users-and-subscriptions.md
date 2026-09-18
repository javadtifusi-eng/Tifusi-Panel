<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 **Users** · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Users and subscriptions

## Users

Users are created, enabled, disabled and deleted individually or in bulk. Each user carries:

| Field | Behaviour |
| --- | --- |
| Data quota | Usage is accounted from the nodes; the user moves to `limited` when the quota is reached. |
| Expiry | The user moves to `expired` on the expiry date. |
| On hold | The validity period starts at the first connection instead of at creation. |
| Device limit | Enforced on the nodes as simultaneous connections; see [Nodes](nodes.md#device-limits-on-the-node). |
| IKEv2/L2TP password | Optional login password, separate from the subscription secret. |
| Groups | Decide which hosts the user receives; see [Groups](cores-and-hosts.md#groups). |

Reusable templates prefill quota, duration and groups for new users.

The device limit cannot be applied to Hysteria2, which runs outside the nodes, or to IKEv2 in PSK mode, which has no per-user identity.

## Subscriptions

Every user has one subscription URL, `/sub/{secret}`, shown with a QR code, and a short access code, `/code/{code}`, meant for reading out when a link cannot be sent. The subscription delivers:

- Per-host `vless://`, `vmess://`, `trojan://`, `ss://` and `hysteria2://` URIs.
- Connection parameters for L2TP and IKEv2, and an IKEv2 `.mobileconfig` profile for iOS and macOS.
- A native profile for Clash-family and sing-box clients, detected by User-Agent.

Resetting a user's secret invalidates both the old link and the old access code.

## Tifusi VPN profile

`GET /sub/{secret}/app.json` and `GET /code/{code}/app.json` return the user's IKEv2, L2TP and VLESS endpoints together with quota and expiry data, in the format read by the [Tifusi VPN](android-app.md) Android app. Connection results the app posts to `/app/report` are listed per user and in the dashboard activity feed.

---

<sub>[← Cores & hosts](cores-and-hosts.md) · [Resellers →](resellers.md)</sub>
