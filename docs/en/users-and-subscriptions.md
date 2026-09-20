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

Settings holds two addresses, and they are allowed to differ. **Panel address** (`public_url`) is where the admin reaches the dashboard and the one the node agent is told to call back on. **Subscription address** (`subscription_url`) is the one every customer-facing link is built from: the subscription URL, the access-code URL, the `.mobileconfig` URL, and the address the Tifusi app is told to poll. Leaving it empty falls back to the panel address, which is how this behaved before the two were separable.

The reason to split them is that a link handed to customers gets forwarded and eventually filtered, and burning it should not take the dashboard with it. Both names have to be on the TLS certificate — request one for both at once (`certbot ... -d panel-domain -d subscription-domain`), because the panel's own SSL button takes a single domain and would drop the other from the certificate.

**Links already saved in customers' apps keep working, and move themselves.** Nothing in any subscription format can rewrite the URL an app has stored — no header exists for it — so a fetch that arrives on the panel address is answered with a permanent redirect (301) to the subscription address instead. Clients follow it, several remember the new address, and `app.json` additionally carries `subscription_url` so the Tifusi app can store it and follow on its own. The redirect is sent before the device limit and on-hold activation run, so one fetch never spends two device slots, and the query string is preserved so `hwid` survives.

What this does *not* move is IKEv2. Its Remote ID and certificate are pinned in each user's imported profile, so changing the address there forces every one of them to re-import — see [Cores & hosts](cores-and-hosts.md). Leave the panel domain resolving and on the certificate for as long as IKEv2 users exist.

## Tifusi VPN profile

`GET /sub/{secret}/app.json` and `GET /code/{code}/app.json` return the user's IKEv2, L2TP and VLESS endpoints together with quota and expiry data, in the format read by the [Tifusi VPN](android-app.md) Android app. Connection results the app posts to `/app/report` are listed per user and in the dashboard activity feed.

---

<sub>[← Cores & hosts](cores-and-hosts.md) · [Resellers →](resellers.md)</sub>
