<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ **Cores & hosts** · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · ✈️ [Telegram bot](telegram-bot.md) · 📱 [Android app](android-app.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Cores, hosts and groups

## Configuration model

```mermaid
flowchart TD
    Core["Core<br/>raw Xray JSON, or IKEv2 / L2TP server settings"]
    Node["Node<br/>address · agent port · API key"]
    Inbound["Inbound<br/>tag · protocol · port · transport · security"]
    Host["Host<br/>public address · port · SNI · fingerprint · remark"]
    Group["Group<br/>access boundary"]
    User["User<br/>quota · expiry · device limit · status"]
    Sub["Subscription<br/>/sub/{secret} · /code/{code}"]
    Out["Share links · Clash · sing-box<br/>app.json: ikev2 · l2tp · vless"]

    Core -->|"assigned to"| Node
    Core -->|"inbounds parsed from config"| Inbound
    Inbound -->|"published through"| Host
    Core -.->|"IKEv2 / L2TP hosts bind to the core"| Host
    Group -->|"restricts visibility of"| Host
    User -->|"member of"| Group
    User --> Sub
    Host --> Sub
    Sub --> Out
```

## Cores

A core is the server-side technology a node runs. It is one of three types:

| Type | Content |
| --- | --- |
| `xray` | A complete Xray JSON configuration, exactly what `xray run -c` accepts, with structured editors for routing, outbounds and DNS. Its inbounds are parsed out and become selectable by hosts and groups. |
| `ikev2` | The server parameters of an IKEv2/IPsec deployment: authentication mode (EAP-MSCHAPv2 or PSK), remote ID and server certificate. |
| `l2tp` | The server parameters of an L2TP/IPsec deployment, including the shared PSK. |

Each core can be assigned to one or more nodes. A node holds one Xray core and one IPsec core at the same time; see [Nodes](nodes.md#two-cores-on-one-node).

## Hosts

A host is the public endpoint a client receives: address, port and display name, for VLESS, VMess, Trojan, Shadowsocks, Hysteria2, L2TP and IKEv2.

- **Xray protocols** reference an inbound parsed from the core configuration and inherit transport, security and REALITY parameters from it. SNI, ALPN, fingerprint, path and security may be overridden for clients.
- **L2TP** hosts bind to an `l2tp` core and use its shared PSK.
- **IKEv2** hosts bind to an `ikev2` core. The server authenticates with an X.509 certificate (self-signed by default, or an imported CA-issued chain) and each user with EAP-MSCHAPv2.
- **Hysteria2** hosts carry their own parameters, since Hysteria2 runs outside the nodes.

### REALITY target scanner

**Find Best Target (SNI)** in the REALITY section of the Xray core form opens the scanner. It runs on a node you pick, because the node is what forwards handshakes to the target:

1. **Find** — *Node neighbours* reads the names off the certificates of every address in the node's own /24, so it finds sites in the same datacenter (fast, and the approach Xray's authors recommend). *Well-known sites* uses a built-in list of about 160 large sites; *My own sites* tests the names you type.
2. **Check** — each name must answer with TLS 1.3 and HTTP/2 and a certificate valid for that name. Neighbours are reached by their address, which becomes the `dest` (`IP:443`).
3. **Prove** — for the best candidates the node starts a real REALITY server and client and loads a page through them once per fingerprint (chrome, firefox, safari, ios, android, edge, 360, qq, random, randomized). ✓ means that fingerprint really connected; ✕ means it didn't.
4. **Iran** — the panel asks probe servers inside Iran (Tehran, Isfahan, Shiraz, Qom, via check-host.net) whether each finalist opens there, and whether the node's own address is reachable. Only the name or the node address is sent. Names that are filtered in Iran are listed last.

**Use** writes the name into `serverNames` and the `dest` into the core's JSON. The scanner needs a node updated to v1.4.1 or later, which also runs Xray 26: on Xray 1.8 the chrome, firefox and safari fingerprints fail against REALITY.

## Groups

Groups are enforced access control, not folders. A host or inbound without a group is visible to all users. Once it is attached to one or more groups, it is included in subscriptions and in node configurations only for members of those groups, so group membership decides both the links a user receives and the credentials rendered onto the nodes.

---

<sub>[← Nodes](nodes.md) · [Users & subscriptions →](users-and-subscriptions.md)</sub>
