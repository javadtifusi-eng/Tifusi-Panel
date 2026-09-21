<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 **Android app** · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Tifusi VPN

[Tifusi VPN](https://github.com/javadtifusi-eng/Tifusi-VPN) is the Android client for Tifusi Panel. It imports a user's servers from the panel and connects in one tap, without going through the phone's VPN settings. The interface is available in Persian and English.

## Importing servers

On the **Servers** tab, enter the user's access code or subscription link and select **Get servers**. Every IKEv2, VLESS and Hysteria2 server of that user is added with its username, password, PSK, remote ID and server certificate. **Refresh** reads changes from the panel again.

The access code looks like `javad7KQ4MP9X` and is shown at the top of the user's subscription page; letter case does not matter. The panel puts its own address into the code (an encoded suffix, not a readable domain, so it survives SMS filtering), so the app needs no address of its own and a domain change needs no new app.

## Protocols

| Protocol | In the app |
| --- | --- |
| IKEv2 (EAP or PSK) | Automatic connect and disconnect on Android 11 and later; on 8-10 it shows the details and opens the phone's VPN settings. |
| VLESS | Through the built-in Xray core. |
| Hysteria2 | The official Hysteria2 client behind the same core, with a QUIC keepalive no subscription link can set. |

For IKEv2 with a self-signed server certificate, the panel sends the CA certificate and the app pins it. A publicly trusted certificate, such as one from Let's Encrypt, needs no CA.

## Reports to the panel

The app reads `app.json` from the panel (see [Tifusi VPN profile](users-and-subscriptions.md#tifusi-vpn-profile)) and posts each connection result to `/app/report`. Results appear on the user's page and in the dashboard activity feed, which helps diagnose a customer's connection without access to their phone.

## Getting the app

`tifusi app` on the panel server prints the latest release and its download link. The app is not tied to a panel and needs no build for yours; to brand it, set `tifusi.supportTelegram` in `gradle.properties` and build. The full instructions are in the [Tifusi VPN repository](https://github.com/javadtifusi-eng/Tifusi-VPN).

---

<sub>[← Telegram bot](telegram-bot.md) · [Network health →](network-health.md)</sub>
