<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 **Tunnels** · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Tunnels

The user connects to the Iran server and traffic travels through the tunnel to the server abroad. The server abroad opens the connection, so it needs no open inbound port.

## Creating a tunnel

1. **Tunnels → New tunnel:** Iran server address and port (default `8443`), server abroad (a panel node or any server), transport, and forwarded ports (TCP or UDP).
2. **Save.** The panel generates an install command for each side.
3. **Install:** run each command on its server, or use **🔑 Install over SSH** to let the panel install it (it sends the offline bundle when the server cannot reach GitHub).
4. Press **Test connection**. A green card means the tunnel is up.

Download the **offline install file for the Iran server** now, for the day international access is cut.

## Transport

| Transport | When |
| --- | --- |
| **TCP Mux** | Default; fastest. |
| **TCP + Stealth** | Plain TCP is detected and cut. |
| **WSS Mux** | The Iran server's IP is filtered; the only option through a CDN. |
| **UDP (KCP)** | Unstable line or high packet loss. |
| **Spoof** | National internet (whitelist). |

**Suggest the best transport** in the form measures both servers and ranks the transports. Confirm the result with a real test after installing.

## Through a CDN

With **WSS Mux**, tick **Route through CDN**, choose ArvanCloud or Cloudflare, and enter a domain that points to the Iran server. Complete the checklist under the form (proxied A record, HTTPS to the origin, WebSocket on).

**⚡ ArvanCloud quality** finds the best edge IPs and SNI and measures real speed. ArvanCloud bills the traffic.

## Spoof tunnel

For the national internet: packets cross the whitelist with a spoofed source address.

1. First run the **IP Spoofing test** card in both directions. If the data centre does not let spoofed packets out, this tunnel will not work.
2. Create the tunnel with the **Spoof** transport: spoofed source (one address, a list or a range) and carrier (UDP, ICMP, ICMPv6 or TCP).
3. If ICMP is blocked, try ICMPv6. Spoof is IPv4 only.

## Other options

- **IKEv2 and L2TP:** forward UDP 500 and 4500 (and 1701 for L2TP). The host must point to the Iran server.
- **Real client IP:** tick **Real IP (PROXY)** on a TCP forward, and set `acceptProxyProtocol: true` on a separate Xray inbound.
- **Chains:** **Tunnels → 🔗 Chains**, to pass through several servers in a row; each hop has its own transport.
- **Update:** **🔄 Update tunnel**; if the tunnel does not come back up, it rolls back automatically.

Technical details: [Architecture](architecture.md#tunnels).

## Advanced settings

**Balanced** mode suits most servers. After any change, press **Install/Update** (users drop for a few seconds).

| Setting | Default | When to change |
| --- | --- | --- |
| Connection count | 8 | "no tunnel connection available": 32 to 128 |
| Address to reach Iran | empty | Iran's IPv4 is unreachable from abroad: Iran's IPv6 |
| KCP window | 1024 | RAM on the server abroad fills up: 256 |
| FEC | 10 and 3 | Unstable line: parity 4 or 5 |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Repeated drops | Switch to TCP Mux, then UDP. |
| Connected but slow | Run **Link test**; with packet loss, use UDP (KCP). |
| Abroad cannot reach Iran | Iran's IPv6 in "Address to reach Iran". |
| Large downloads stop midway | Update both sides. |
| Stealth never connects | Sync the two servers' clocks. |
| Only one country is bad | The problem is that country's server. |

---

<sub>[← Resellers](resellers.md) · [Telegram bot →](telegram-bot.md)</sub>
