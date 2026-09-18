<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 **Resellers** · 🚇 [Tunnels](tunnels.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Resellers

A reseller is a separate sign-in that sells on the owner's infrastructure. It manages only its own users and never sees the servers behind them.

## Creating a reseller

Only the owner can open the **Resellers** page. Each reseller account is created there with:

| Setting | Effect |
| --- | --- |
| Username and password | The reseller's own sign-in to the dashboard. |
| Allowed protocols | The protocols the reseller may hand out. At least one is required. |
| User limit | Optional maximum number of users the reseller can hold. |
| Data quota | Optional total volume the reseller can hand out across its users. |

## What a reseller can do

- See and manage only the users it created.
- Pick one of its allowed protocols for each user; the user's links and node credentials are narrowed to that protocol.
- See its remaining allowance on the **Users** page.

A reseller has no access to nodes, hosts, cores, tunnels, groups, statistics, user templates or settings, and cannot assign groups.

## How the limits are counted

The data quota is the live sum of the data limits carried by the reseller's current users; there is no separate balance to keep in step. Deleting a user frees its volume. A reseller with a data quota cannot create users with unlimited data, since such a user would bypass the quota. When a limit is reached, the request is refused with the remaining allowance in the message.

Settling payment with a reseller happens outside the panel.

---

<sub>[← Users & subscriptions](users-and-subscriptions.md) · [Tunnels →](tunnels.md)</sub>
