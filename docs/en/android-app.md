<sub>[← README](../../README.md) · 🚀 [Installation](installation.md) · 🖥️ [Nodes](nodes.md) · 🧩 [Cores & hosts](cores-and-hosts.md) · 👥 [Users](users-and-subscriptions.md) · 🤝 [Resellers](resellers.md) · 🌉 [Tunnels](tunnels.md) · 🤖 [Telegram bot](telegram-bot.md) · 📱 **Android app** · ⚙️ [Operations](operations.md) · 🐳 [Deployment](deployment.md) · 🏗️ [Architecture](architecture.md) · 🛠️ [Development](development.md)</sub>

# Tifusi VPN

[Tifusi VPN](https://github.com/javadtifusi-eng/Tifusi-VPN) is the Android client for Tifusi Panel. It imports a user's servers from the panel and connects in one tap, without going through the phone's VPN settings. The interface is available in Persian and English.

## Importing servers

On the **Servers** tab, enter the user's access code or subscription link and select **Get servers**. Every IKEv2 and L2TP server of that user is added with its username, password, PSK, remote ID and server certificate. **Refresh** reads changes from the panel again.

The access code looks like `javad7KQ4MP9X` and is shown at the top of the user's subscription page; letter case does not matter. A bare code goes to the panel the app was built for; for any other panel, write `code@panel-domain`, for example `ali7KQ4MP9X@panel.example.com`.

## Protocols

| Protocol | In the app |
| --- | --- |
| IKEv2 (EAP or PSK) | Automatic connect and disconnect, Android 11 and later. |
| L2TP/IPsec | Shows the connection details and opens the phone's VPN settings. |

For IKEv2 with a self-signed server certificate, the panel sends the CA certificate and the app pins it. A publicly trusted certificate, such as one from Let's Encrypt, needs no CA.

## Reports to the panel

The app reads `app.json` from the panel (see [Tifusi VPN profile](users-and-subscriptions.md#tifusi-vpn-profile)) and posts each connection result to `/app/report`. Results appear on the user's page and in the dashboard activity feed, which helps diagnose a customer's connection without access to their phone.

## Getting the app

`tifusi app` on the panel server prints the latest release and its download link. To build the app for your own panel, set `tifusi.panelUrl` in `gradle.properties` to your panel's address, optionally set `tifusi.supportTelegram`, and build; the full instructions are in the [Tifusi VPN repository](https://github.com/javadtifusi-eng/Tifusi-VPN).

---

<sub>[← Telegram bot](telegram-bot.md) · [Operations →](operations.md)</sub>
