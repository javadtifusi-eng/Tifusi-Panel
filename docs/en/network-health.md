<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 📶 **Network health** · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Network health

Filtering in Iran rarely hits every operator at once. Network health shows, on the dashboard, how well users connect **on each operator** — MCI, Irancell, TCI, RighTel and the main fixed-line ISPs — so a block on one of them shows up as a drop on that operator's card instead of a pile of "it doesn't connect" messages.

## What it shows

- **Connection success** across all operators, with the number of attempts and users behind it.
- **Alerts** when an operator's success rate in the last hours is at least 20 points below its earlier rate, and when most subscription requests from one operator fail — a sign the subscription domain is blocked there.
- **A card per operator**: success rate, attempts, users, subscription success, and a state — healthy (90 % and up), weak (75–90 %), disrupted (below 75 %), or *too little data* under five attempts.
- **A chart over time** for the three busiest operators; hover it for each hour's numbers.
- **Protocol by operator**: which protocol works on which network. Cells below 75 % are marked ✕.

The range can be 6 hours, 24 hours or 7 days. The card refreshes every minute.

## Where the data comes from

The [Tifusi VPN](android-app.md) Android app reports every connection attempt and subscription fetch to the panel. Network health is built from those reports, so it covers **app users only** — clients such as v2rayNG don't report anything. With few app users the numbers are a sample, not the whole picture; cards with under five attempts say so.

Each report is matched to an operator by:

1. **The reporting IP**, against the address ranges each operator announces. The panel downloads these lists from RIPEstat once a day and matches locally; users' IPs are never sent anywhere.
2. **The SIM operator** the app reports, when the IP doesn't match and the phone is on mobile data. On Wi-Fi the SIM says nothing about the network, so it isn't used.

Reports that match neither are grouped as *Unknown* — typically ones sent through the VPN itself, or from an ISP not in the list.

---

<sub>[← Android app](android-app.md) · [Operations →](operations.md)</sub>
