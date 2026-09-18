<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 **Tunnels** · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Tunnels

A tunnel publishes a server abroad through a relay server inside a restricted network. Clients connect to the relay; the foreign server dials out to the relay, so it needs no open inbound port of its own.

```mermaid
flowchart LR
    Client(["Client"]) -->|"public port"| Relay["Relay server<br/>inside the restricted network"]
    Foreign["Foreign server<br/>node or any server"] -->|"outbound connection<br/>chosen transport"| Relay
    Relay -.->|"forwarded ports"| Foreign
```

The relay runs as its own agent on both servers. The panel stores the tunnel's configuration and generates the install command for each side, so the token and port map are never typed twice; it does not manage the agent after installation.

## Creating a tunnel

| Setting | Purpose |
| --- | --- |
| Relay address and port | The public listener clients connect to. The port defaults to `8443`. |
| Foreign side | A node already registered in the panel, whose address is reused, or any other server by address. |
| Transport | How the foreign side connects to the relay (see below). |
| SNI and domain | For `tls`, `wss` and `wssmux`. A domain can be issued a Let's Encrypt certificate during installation. |
| Path | For `ws`, `wss`, `wsmux` and `wssmux`. |
| Connection count | How many physical connections the foreign side keeps open. Defaults to `8`. |
| Forwarded ports | Named port mappings, each TCP or UDP, from a relay port to a port on the foreign server. |

A token is generated automatically for each tunnel.

### Transports

| Transport | Description |
| --- | --- |
| `tcp` | Plain TCP. |
| `tls` | TCP inside TLS. |
| `ws` / `wss` | WebSocket, plain or over TLS. Suitable behind a CDN. |
| `tcpmux` / `wsmux` / `wssmux` | Multiplexed variants that carry many streams over fewer connections. |
| `udp` | Plain UDP. |

## Choosing a transport

Before the tunnel exists, **Recommend best transport** probes both servers and reports reachability and latency to each, then ranks the transports. The ranking reflects what can honestly be measured from outside the restricted network; it cannot predict how a particular filter will treat each transport, so test the chosen one after installation.

## Installing and testing

1. Open the tunnel and copy the install command for each side.
2. Run the relay command on the relay server and the foreign command on the foreign server.
3. Select **Test connection**. The panel checks that it can reach the relay server, the foreign server and the tunnel's public port, and records the tunnel as `connected` or `error` with the latency and time of the check. A `udp` tunnel cannot be checked from outside; its service log is read on the relay server with `journalctl -u tifusi`.

## Spoof test

Some tunnel types depend on the relay's datacenter allowing packets with a forged source address to leave its network. **IP Spoofing test** generates two commands, one for each server, that check this before any such tunnel is built. Nothing runs on the servers until the commands are executed there.

## Tunnels and IKEv2 or L2TP

For native IKEv2 or L2TP through a tunnel, forward UDP 500 and 4500 from the relay to the foreign server, and UDP 1701 as well for L2TP clients without IPsec. The host published to users then points at the relay's address.

---

<sub>[← Resellers](resellers.md) · [Telegram bot →](telegram-bot.md)</sub>
