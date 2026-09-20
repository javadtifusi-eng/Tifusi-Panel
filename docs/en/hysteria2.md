<sub>[← README](../../README.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 🎛️ [Operations](operations.md)</sub>

# Hysteria2

Hysteria2 runs beside Xray on a node as its own small server, over UDP. It exists for one case: a network where TCP-based protocols (REALITY, XHTTP over TCP) are poor and UDP is not.

Every user of the panel can use it with the subscription they already have: their subscription secret is their Hysteria2 password.

## The port decides everything

MCI (Hamrah-e Aval) does not throttle UDP as such — it classifies UDP by port and treats the classes very differently. Measured from one MCI phone against this node, with the server, certificate, obfuscation password and user all held constant and **only the port changing**:

| UDP port | What normally lives there | Download | Upload | Latency |
| --- | --- | --- | --- | --- |
| 443 | QUIC | **nothing at all** | — | — |
| 36718 | nothing in particular | poor | poor | |
| 53 | DNS | 3 Mbps | 1.5 Mbps | good |
| 1194, 51820 | OpenVPN, WireGuard | good | — | **poor** |
| **8801** | **Zoom media** | **40 Mbps** | **3.5 Mbps** | **good** |

Same server, same everything: **3 Mbps on port 53 against 40 Mbps on port 8801**, and that 40 was measured at the busiest hour of the day. Nothing else on this page matters as much as that row.

The pattern behind it is worth keeping, because it says which port to try next if 8801 is ever throttled:

- **A port whose traffic is expected to be small gets capped in the direction that would be large.** Port 53 passed the upload freely, since upstream packets there look like DNS queries — but it capped the download near 3 Mbps, because a DNS *response* is supposed to be small, and a flood of large packets leaving port 53 is exactly what DNS-tunnel detection exists to catch.
- **VPN ports carry bulk but are not protected for latency.** 1194 and 51820 moved the volume and still felt bad to use.
- **What works is traffic the operator cannot afford to degrade.** Real-time video needs high bandwidth in *both* directions *and* low latency at the same time, so an operator that polices it breaks its own subscribers' video calls. Zoom's media port won; the other candidates in that class — 3478 (WebRTC/STUN) and 19302 (Google Meet) — are the ones to try next, and both were confirmed to work on this server.

This also corrects a wrong reading that was recorded on this page earlier: a probe on a random high port measured about 10 Mbps down and concluded that was the path's ceiling. It was measuring the throttle applied to that port class, not the path. The path does 40.

## The uplink is a real ceiling, and the download's ACKs ride on it

Upload settles around 3.5 Mbps, and that is genuine capacity rather than an artefact. It was tested rather than assumed: BBR was suspected of reading MCI's deliberate drops as congestion and parking below the true rate, so the server was switched to honour a client-declared rate (`ignoreClientBandwidth: false` plus `bandwidth` caps) and the client was told to declare 6 Mbps up, which puts its uplink on Brutal — the controller that paces at a fixed rate and treats loss as noise. The result was much worse, and worse *in both directions*: the download's QUIC ACKs travel on that same uplink, so overdriving it damages the download too. It was reverted, and the reasoning is written into `config.yaml` so it is not retried without new evidence.

Two things follow. Hysteria2 still beats a TCP protocol upstream here, because TCP reads that loss as congestion and collapses — 0.12 Mbps measured against 1.2 on a throttled port, and everything a browser sends travels upstream, so this is why pages *start* instead of hanging. And there is no tuning left for the uplink: it has no headroom, and Hysteria2 has no forward error correction, so lost upstream packets are simply retransmitted. The protocol that would attack the loss itself is one with FEC — Xray's mKCP — which is untested on this path and, unlike Hysteria2, would live inside the panel's existing Core and Inbound machinery.

## What has to be true for it to work from Iran

- **Obfuscation is required.** A bare Hysteria2 handshake is a QUIC handshake, and Iranian networks drop it wholesale. With `obfs: salamander` the first packet looks like nothing in particular.
- **The port is the single biggest lever**, as above. Not UDP 443, which answered nothing at all from Iran on mobile and fixed lines alike — but not a random high port either, which measured poor. Pick a port whose traffic class the operator has to keep healthy.
- Large QUIC windows, because the path from Iran to a node abroad has high latency.

## Setting it up

The panel does not start Hysteria2; run the official image next to the node agent, on the node, with host networking.

`/opt/tifusi-panel/data/hysteria/config.yaml` (create it yourself; `data/` is not committed):

```yaml
listen: :8801   # see "The port decides everything" above — this is not arbitrary

tls:
  cert: /certs/fullchain.pem
  key: /certs/privkey.pem

auth:
  type: http
  http:
    url: http://127.0.0.1:8000/api/hysteria/auth/<TOKEN>

obfs:
  type: salamander
  salamander:
    password: <random obfs password>

masquerade:
  type: proxy
  proxy:
    url: https://127.0.0.1:443/
    rewriteHost: true

trafficStats:
  listen: 127.0.0.1:9998
  secret: <random stats secret>

# Pin both directions to BBR whatever the client app claims its bandwidth is.
ignoreClientBandwidth: true

quic:
  initStreamReceiveWindow: 26843545
  maxStreamReceiveWindow: 26843545
  initConnReceiveWindow: 67108864
  maxConnReceiveWindow: 67108864
  maxIdleTimeout: 60s

congestion:
  type: bbr
  bbrProfile: conservative
```

### Why those last three keys

**`ignoreClientBandwidth: true`.** Hysteria2 has two congestion controllers. BBR measures the path and adapts. Brutal paces at a rate it is *told* and treats loss as noise rather than as a signal to slow down — which is the right trade on a lossy but genuinely fast link, and catastrophic when the declared rate is wrong. Left to itself the server obeys whatever rate the client app declares, so an app with "100 Mbps" typed into its bandwidth fields puts the server on Brutal into whatever ceiling the operator is holding that port class to, where the measured cost of overshooting is heavy packet loss — and the upload experiment above showed how badly that ends. This key makes the server ignore the declaration and also tells the client to do the same, so the outcome no longer depends on a stranger's app settings. Verified both ways on a throwaway server: with the key off, a client declaring 100 Mbps logged `client connected {"tx": 12500000}`; with it on, the same client logged `tx: 0`, which is BBR.

Tifusi's own links declare nothing, so every real `client connected` line already logged `tx: 0` — this is a guard, not a fix for something that was happening. The upload experiment described above is the one time it was deliberately turned off, and it was turned straight back on.

**`bbrProfile: conservative`.** Lower gains than standard BBR, it drains the queue it builds, and it cuts its rate when it detects it overshot. That is the right shape for a path that *polices* — drops on purpose to hold a rate — rather than one that queues, and it keeps latency down, which is what actually decides whether YouTube and Instagram feel usable. This was in place for the 40 Mbps measurement, so it stays.

**`maxIdleTimeout: 60s`.** Hysteria's default is 30 seconds, and on MCI every connection died at almost exactly that:

```
13:51:28  client connected     {"addr": "37.63.232.153", "tx": 0}
13:51:59  client disconnected  {"error": "accepting stream failed: timeout: no recent network activity"}
13:52:12  client connected     {"addr": "83.121.224.193", "tx": 0}
13:52:45  client disconnected  {"error": "... no recent network activity"}
```

The network was not the cause: the same MCI path kept a UDP mapping alive through 60 seconds of silence and answered a 90-second flow without dropping it. Those were idle timers firing on a live path, and each one costs a fresh handshake over an uplink that loses 30% of packets — which is what "it connects and then stalls every few seconds" feels like.

Be clear about what this key does and does not achieve. QUIC uses the **lower** of the two ends' advertised idle timeouts, so raising it on the server changes nothing for a client that still advertises 30 seconds, and the setting that really prevents the timer from ever firing is the client's `keepAlivePeriod`. That one is not reachable from a subscription: **mihomo, sing-box and the `hysteria2://` URI all have no keepalive or idle-timeout field**, and only the official client's YAML config does. So the server side is raised here for clients that cooperate, and the reconnect churn is a known remaining limit rather than something the panel can configure away.

`<TOKEN>` is derived from the panel's secret key (`app/routers/hysteria.py::auth_token`), so it survives restarts and needs no storage; print it with:

```bash
docker exec tifusi-panel python -c "import sys; sys.path.insert(0,'/app'); from app.routers.hysteria import auth_token; print(auth_token())"
```

```bash
docker run -d --name tifusi-hy2 --network host --restart unless-stopped \
  -v /opt/tifusi-panel/data/hysteria/config.yaml:/etc/hysteria/config.yaml:ro \
  -v /opt/tifusi-panel/certs:/certs:ro \
  tobyxdd/hysteria:latest server -c /etc/hysteria/config.yaml
```

Tell the **node agent** where Hysteria's statistics API is by adding two environment variables to the node container: `HYSTERIA_API=http://127.0.0.1:9998` and `HYSTERIA_SECRET=<the stats secret>`. Then add a **Host** of protocol Hysteria2 (address, port, SNI, and the obfs password in *Obfuscation password*). Every user without a group restriction receives it in the next subscription refresh, in the link, Clash and sing-box formats alike.

## How the panel stays in control

- **Authentication.** Hysteria2 asks the panel who a password belongs to on every new connection (`POST /api/hysteria/auth/<token>`). The panel answers only for an `active` user whose allowed protocols include Hysteria2, and only to a caller on the same machine.
- **Usage.** Each poll cycle the panel reads Hysteria2's counters through the node agent (`/hysteria/stats`, cleared as they are read, exactly like Xray's) and adds them to the user's usage, so data limits see every byte. Checked on a live node: 20,000,000 bytes through it were counted as 20,001,643.
- **Disconnecting.** When a user expires, hits a limit or is disabled, the panel asks Hysteria2 to kick them (`/hysteria/kick`). Hysteria2 acts on the next traffic of that connection — an idle connection stays until it next moves a byte, and the user cannot reconnect either way.

## Limits

- One Hysteria2 server per node, and the panel expects it on the same machine as the node agent.
- The obfuscation password is shared by all users; it hides the shape of the traffic and identifies nobody.
- **Nothing synchronises the Host with the server.** A Hysteria2 Host has no Inbound and no Core — its port, SNI and obfuscation password sit directly on the Host, and `app/cores/sync.py` does not know Hysteria2 exists. The Host only *describes* a server that must already be running on that machine, so changing the obfuscation password in the panel without editing `config.yaml` and restarting the container silently breaks every link. Making the panel push this config the way it pushes a Core is the obvious next step, and the `hysteria2 is the one exception: no Core concept for it yet` comment in `app/models/host.py` is where that gap is recorded.
- **`install-node.sh` does not install Hysteria2**, so a freshly added node has none until the container above is started by hand.
- Reconnect churn on high-loss mobile paths, as described above: the panel cannot set a client's keepalive through any subscription format.
