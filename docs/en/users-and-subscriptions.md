<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 **Users** · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · 🔀 [Domain rotation](domain-rotation.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Users and subscriptions

## Users

Users are created, enabled, disabled and deleted individually or in bulk. Each user carries:

| Field | Behaviour |
| --- | --- |
| Data quota | Usage is accounted from the nodes; the user moves to `limited` when the quota is reached. |
| Expiry | The user moves to `expired` on the expiry date. |
| On hold | The validity period starts at the first subscription fetch instead of at creation; opening the subscription in a browser also counts. |
| Device limit | Enforced on the nodes as simultaneous connections; see [Nodes](nodes.md#device-limits-on-the-node). |
| IKEv2/L2TP password | Optional login password, separate from the subscription secret. |
| Groups | Decide which hosts the user receives; see [Groups](cores-and-hosts.md#groups). |

Reusable templates prefill quota, duration and groups for new users.

For the default deployment, node-side limits apply to Xray and IKEv2 EAP. IKEv2 in PSK mode has no per-user identity, so the same device limit cannot be enforced there.

## Renewing an expired user

1. Open the user's edit form and set a future expiry date, or remove the expiry.
2. Save. An `expired` user becomes `active` if traffic remains, or `limited` if the data quota is still exhausted.
3. If more traffic is needed, raise the quota as well. Renewal keeps `used_traffic`; it does not reset usage or add a new package's volume automatically.

A date still in the past leaves the user expired. Editing a note alone does not renew the account. A manually disabled or on-hold account keeps its status, and an explicit `status` in an API update takes precedence.

Individual edits (`PUT /api/users/{id}`) and bulk edits (`POST /api/users/bulk-update`) use the same status rules. Raising the quota restores a limited user only while its expiry is valid; extending an expired user restores service only while traffic remains. Explicit status changes take precedence in both paths.

## Subscriptions

Every user has one subscription URL, `/sub/{secret}`, shown with a QR code, and a short app code. The short share link `/app/s/{code}` redirects to that subscription. The subscription delivers:

- Per-host `vless://`, `vmess://`, `trojan://`, `ss://` URIs.
- Connection parameters for IKEv2, and an IKEv2 `.mobileconfig` profile for iOS and macOS.
- A native profile for Clash-family and sing-box clients, detected by User-Agent.

Resetting a user's secret invalidates both the old link and the old access code.

### Share links and client formats

| Address | Purpose |
| --- | --- |
| `/app/s/{code}` | Short share link; a `302` redirect to `/sub/{secret}`. |
| `/sub/{secret}` | HTML account page when the browser requests `text/html`; otherwise a plain, Clash or sing-box subscription. |
| `/sub/{secret}/install/ikev2` | iPhone/macOS profile installation page. |
| `/sub/{secret}/ikev2.mobileconfig` | Downloadable IKEv2 profile. |
| `/code/{code}/app.json` | App configuration by short code; `/code/{code}` alone is not a web page. |

The old `/sub/{secret}/guide` page is disabled and returns `404`, including `?full=1`. Share the short link or the subscription URL instead. Following a short link has the same on-hold activation behavior as opening the subscription directly.

The default deployment serves VLESS, VMess, Trojan, Shadowsocks and IKEv2. Other protocol references describe retained legacy code; see [Deployment](deployment.md).

### The address customers are given

Settings holds two addresses. **Panel address** is where the admin reaches the dashboard and what the node agent calls back on; **Subscription address** is what every customer-facing link is built from, so a domain that gets shared around and filtered can be replaced without moving the dashboard. Empty falls back to the panel address. Both names must be on the TLS certificate — request one for both at once, since the panel's own SSL button takes a single domain and drops the other.

Links already saved in customers' apps keep working: a fetch on the panel address is answered with a 301 to the subscription address, and `app.json` carries `subscription_url` so the Android app can follow by itself. IKEv2 does not move — its Remote ID is pinned in every imported profile — so keep the panel domain resolving and on the certificate while IKEv2 users exist.

## Android app configuration API

`GET /sub/{secret}/app.json` and `GET /code/{code}/app.json` return the user's available endpoints together with quota and expiry data for compatible Android clients. Protocol filtering also applies to these responses. Connection results the app posts to `/app/report` can be retrieved per user; dashboard presentation depends on the deployed UI.

---

<sub>[← Cores & hosts](cores-and-hosts.md) · [Resellers →](resellers.md)</sub>
