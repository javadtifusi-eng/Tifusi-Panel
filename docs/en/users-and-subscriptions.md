<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 **Users** · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Users and subscriptions

## Creating users

**Users → New user** (or in bulk). Templates prefill traffic, duration and groups.

| Field | Behaviour |
| --- | --- |
| Traffic | At the cap the user becomes `limited`. |
| Expiry | On the expiry date the user becomes `expired`. |
| On hold | The period starts at the first subscription fetch. |
| Device limit | Concurrent connections; for Xray, IKEv2 (EAP mode) and L2TP. |
| IKEv2/L2TP password | Optional, separate from the subscription link. |
| Groups | Decide which [hosts](cores-and-hosts.md) the user receives. |

## Renewing

1. Edit the user and set a new expiry date.
2. If the traffic is used up, raise the cap too.
3. Save; the user becomes `active` automatically.

Renewal does not reset past usage. A user disabled by hand stays disabled.

## Subscriptions

Each user has a subscription link, a QR code and a short link:

| Link | Use |
| --- | --- |
| `/app/s/{code}` | Short link to send to the customer |
| `/sub/{secret}` | Account page in a browser; configs in an app (plain, Clash or sing-box) |
| `/sub/{secret}/install/ikev2` | IKEv2 profile install on iPhone and Mac |

**Reset key** invalidates the previous link and code.

## Subscription domain

In **Settings**, set the **subscription address** apart from the panel address, so a filtered subscription domain can change without moving the panel. Old links redirect to the new address automatically. The TLS certificate must cover both domains. Keep the panel domain while you have IKEv2 users.

---

<sub>[← Cores & hosts](cores-and-hosts.md) · [Resellers →](resellers.md)</sub>
