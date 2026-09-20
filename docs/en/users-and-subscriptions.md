<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 **Users** · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

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

### The address customers are given

Settings holds two addresses. **Panel address** is where the admin reaches the dashboard and what the node agent calls back on; **Subscription address** is what every customer-facing link is built from, so a domain that gets shared around and filtered can be replaced without moving the dashboard. Empty falls back to the panel address. Both names must be on the TLS certificate — request one for both at once, since the panel's own SSL button takes a single domain and drops the other.

Links already saved in customers' apps keep working: a fetch on the panel address is answered with a 301 to the subscription address, and `app.json` carries `subscription_url` so the Tifusi app can follow by itself. IKEv2 does not move — its Remote ID is pinned in every imported profile — so keep the panel domain resolving and on the certificate while IKEv2 users exist.

## Tifusi VPN profile

`GET /sub/{secret}/app.json` and `GET /code/{code}/app.json` return the user's IKEv2, L2TP and VLESS endpoints together with quota and expiry data, in the format read by the [Tifusi VPN](android-app.md) Android app. Connection results the app posts to `/app/report` are listed per user and in the dashboard activity feed.

---

<sub>[← Cores & hosts](cores-and-hosts.md) · [Resellers →](resellers.md)</sub>
