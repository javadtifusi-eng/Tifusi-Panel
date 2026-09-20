# Changelog

## v1.4.2 — 2026-09-19

### REALITY scanner
- **No built-in list of target names, anywhere.** The "Critical services" and "Well-known sites" lists are gone from the source. A name published in a panel's code is the first one a censor blocks, and a name that is excellent on one server's network is ordinary on another's — so every scan now discovers its own targets live, from the TLS certificates of the node's own datacenter neighbours.
- **One flow instead of five tabs.** "Critical services", "Well-known sites", "My SNIs" and "New server (before it's a node)" are removed, along with the endpoints behind them. There is one button: each press walks one ring further out from the node's /24 and skips every name found before, so a scan never repeats the last one's sites.
- **Open from Iran is now a gate, not a label.** Every name that passes TLS 1.3 and HTTP/2 is checked from probe servers inside Iran (check-host.net) *before* anything else happens to it. A name that isn't open from every city that answered is dropped — it could not be used whatever else it scored — and only the survivors go back to the node for the per-fingerprint REALITY test. The test used to run on the fastest names first and learn about Iran afterwards, which spent minutes proving names that were blocked.
- **Ranked by speed, not by working.** Plenty of SNIs are open from Iran and still slow, and a slow target makes a slow tunnel. Each Iranian probe now reports how long it took to reach the name, and the median of those is shown per target and decides the order after working with chrome and holding up under load (below), ahead of the node→target handshake. Fingerprints are listed fastest first too, each with its measured time, instead of in a fixed order.
- **Load test: does the target keep working?** REALITY relays a full handshake to the target for every new connection a user opens, so the node hits it all day, and most of what a neighbour scan finds is a small machine behind a rate limiter. Such a target shuts the node out long before Iran blocks anything, and then every new connection breaks while every check still shows green. Each finalist now gets 20 handshakes at once, 3 a second for 15 seconds, and 3 more after a pause; the result shows as *Holds under load 100%* (success only — concurrent handshakes timed from the node measure the node's own CPU, not the target), and a target that stops answering the node afterwards is marked and sinks to the bottom. Holding up under load now ranks above speed, since a fast target that drops connections is worse than a slightly slower one that doesn't.
- **Test from this device.** check-host.net's Iranian probes all sit in datacenters, so a name they find open can still be blocked on a mobile operator — the "fine on TCI, poor on MCI" case. A new section in the scanner connects to each finalist from the admin's own browser, on whatever network the laptop or phone is on, and labels the result with the operator the panel recognises from its IP (MCI, Irancell, TCI, RighTel…). A browser that turns out not to be on an Iranian operator — usually a VPN — is flagged instead of being reported as Iran. Results are kept per operator, so testing on MCI and then on Irancell shows both side by side, and a name the admin's own operator blocks sinks below the rest. A browser can only reach the site itself, not the node with a chosen SNI, so this answers whether an operator lets the name through; the phone test still measures the tunnel.
- **The operator-pattern test drops the own-domain control and reads the upload separately.** Tried on a live MCI phone, the admin's own domain as SNI never connected at all while borrowed names carried 16 Mbps — under a whitelist a fresh unknown domain is the worst name to borrow, and announcing your own is the opposite of what REALITY is for. What is left is the question the test can answer: one borrowed SNI across several standard HTTPS ports and a random one, a second borrowed SNI to tell a bad port from a bad name, and upload read apart from download — because MCI's documented throttle leaves the download alone and pins the upload under 1 Mbps, which no port or SNI can fix.
- **Find the operator's pattern.** "Fine on TCI, poor on MCI", while the device test showed MCI leaving most of the SNIs open, says the SNI is not what MCI judges — and every earlier test held the two likelier suspects fixed: the port (always a random high one, where no real HTTPS server lives) and the IP/SNI mismatch every neighbour SNI has, since the client dials the node while the name's DNS points elsewhere. A new button in the phone test builds one subscription whose configs each differ from another in one thing only: the best SNI on a random port and on standard HTTPS ports (2053, 8443), your own domain as SNI (found automatically among your hosts when it resolves to the node and serves TLS 1.3 there) on both kinds of port, and the second-best SNI on a standard port. Test it on the phone on that operator and the panel compares the results and names the pattern — port, IP/SNI mismatch, or the address/route itself, where no SNI helps and a relay or CDN is the fix — with a button to use your own domain as SNI when that is what wins.
- Every phone-test result now says which operator the connections came from (MCI, Irancell, TCI…), recognised from their addresses.
- The phone test reports the **sustained** rate — everything that moved, over the time it took — next to the peak. Operators hand out a burst at the start of a transfer and a speed test is mostly that burst, so the peak flattered every config alike; the sustained figure now leads and decides the ranking and the operator-pattern verdict.

### Node
- **Xray's error log is kept.** Only the access log was configured, so a REALITY handshake a censor broke, or a client Xray rejected, left no trace anywhere — the one thing needed to tell filtering from a bad config. The pushed config now sets `log.error` to `data/xray-error.log` beside the access log.
- An app report that reaches the panel through the API port rather than the dashboard's nginx arrives with Docker's gateway address instead of the phone's, and its operator was lost. With no usable address, the phone's own carrier is used instead of discarding the report — on wifi that is still ignored, since a SIM says nothing about the connection traffic actually took.
- The real test from inside Iran, which measures actual throughput per SNI from a phone, remains the last word on speed.

## v1.4.1 — 2026-09-18

### Subscription page
- QR codes are dark on white again. The light-on-dark codes couldn't be read by the iPhone camera and many scanner apps.
- Redesigned in the panel's own look, with the Tifusi logo, a data-usage bar, a direct download of the Tifusi VPN Android app and a one-tap iPhone/Mac profile button.

### REALITY scanner
- Runs on the node itself. It finds candidate sites in the node's own datacenter from their certificates (or uses the built-in list, or names you type), keeps those with TLS 1.3 and HTTP/2, and proves the best ones with a real REALITY connection per fingerprint: each of chrome, firefox, safari, ios, android, edge, 360, qq, random and randomized is marked by whether a page actually loaded through it.
- Checks from probe servers inside Iran (check-host.net) whether each finalist and the node's own address are reachable there; filtered names are listed last.
- Real test from inside Iran: the node opens a temporary REALITY config per top site (30 minutes, its own Xray process, the live config untouched) and gives one subscription link. Import it on a phone on Iranian internet and run a real-delay test; each site that actually carried traffic through Iran's filtering to the node turns green. The on-server fingerprint test is now labelled as such.
- Up to 20 finalists get the check-host.net Iran check instead of 8.
- Shows only the five best sites instead of a long list: really working with chrome, open from every checked city in Iran, and on the node's own network first (no IP/SNI mismatch for the censor to throttle). The rest stay behind “show all”.
- New “My SNIs” tab: type names you got elsewhere and each one gets the same on-node test, Iran check and test config.
- New default “Critical services” tab: services Iran itself depends on (OS updates, developer registries, science publishers, CDNs), so blocking or throttling them is costly. Every name that works on the node is checked from inside Iran and the best five are shown; the built-in list keeps only the 62 that were open from every Iranian city in a live run.
- The Iran check now shows up reliably: it used to start only after the first status poll, which was also the poll that stopped the dashboard from asking again.

### Node
- The node agent starts Xray again from its last config after a container restart, instead of leaving users offline until the panel's next push.
- Each working fingerprint shows its real ping (median of three requests after a warm-up, timed one fingerprint at a time). The fastest and slowest are only called out when the gap is real — usually they are within a few milliseconds of each other.
- Real ping to each target, measured from the node by IP after the scan's burst of checks: median of five TCP connects and three TLS handshakes. Targets are ranked by being open from Iran, working with chrome, then the shortest handshake — REALITY waits on it for every new connection.
- **New server (before it's a node)** replaces *My own sites*: the panel gives a one-line command that runs the scanner on a server that isn't a node yet and reports back, so its targets are known before it's added.
- **Find more sites**: each round of the neighbour scan walks out to the next /24s either side of the node (its own /24, then ±1, ±2…) and skips every name already found, so every round shows only new targets.
- Live progress and results; **Use** writes the name and `dest` into the core's JSON.

### Nodes
- Xray 26.3.27 instead of 1.8.24. REALITY on 1.8 rejected the post-quantum key share of current chrome, firefox and safari fingerprints, so those clients failed while ios, edge and qq connected. Re-run the node installer to update a node.
- The node installer turns on BBR congestion control with fq pacing, larger socket buffers and MTU probing. On the long, lossy links from Iran to a node abroad, cubic halved its rate on every lost packet; BBR paces to the measured bandwidth. Only new connections are affected, so nothing drops while it applies.

### Tunnels
- **Route through a CDN** (ArvanCloud recommended, or Cloudflare): the foreign server dials a CDN name instead of the relay's IP, so the tunnel survives if that IP is filtered. The panel sets the SNI, a random WebSocket path and the port itself, and shows a checklist of what to set in the CDN panel.
- **Test connection** on a CDN tunnel adds a CDN path step that opens a real WebSocket upgrade through the CDN and only passes on a `101` answer.
- **ArvanCloud quality** sheet on CDN tunnels, measured from the foreign node (or the panel): **clean IPs** — edge addresses from the provider's ranges tried with a real WebSocket through to the relay, the best pinned into the foreign config and connections spread across them; **front SNI** — Iranian sites really on the same CDN, offered only if they carry the tunnel (domain fronting); and a **real speed test** that downloads 8 MB from the relay through the CDN with the saved edge and SNI.
- The tunnel program spreads connections over several CDN edges, skips a dead one, sends a separate WebSocket `Host` for fronting and answers the panel's speed test. Re-run the install command on both servers to get it.
- The CDN checklist adds turning off caching and the security challenge / WAF for the tunnel's subdomain; a CDN tunnel starts with 16 connections instead of 8.
- The transport picker is down to three cards — TCP Mux, WSS Mux and UDP (KCP) — plus IP Spoofing, which opens the spoof test. Tunnels on the other transports keep working.

### Dashboard
- The network health card is off the dashboard again; the dashboard is as it was in v1.3.

## v1.4 — 2026-09-18

### Connection Shield
- Groups of interchangeable Iran relays under **Settings → Connection Shield**. The panel checks every relay from abroad every 30 seconds; when the active one fails three checks in a row it is marked burnt and users move to the next healthy standby.
- Two ways to move users: a Cloudflare DNS record (users' configs follow it on their own, no subscription update) or rewriting host addresses.
- A burnt relay that answers again goes back to standby. Relays can also be moved to by hand.
- Every move, burn, recovery and error is listed under the group and sent to Telegram, Discord and the webhook (`shield_*` events).

### Network health
- New dashboard card with connection success per operator (MCI, Irancell, TCI, RighTel and the main ISPs) and per protocol, over 6 hours, 24 hours or 7 days.
- Alerts when an operator's success rate drops sharply, and when most subscription requests from one operator fail — a sign the subscription domain is blocked there.
- Built from Tifusi VPN app reports. The operator is found from the reporting IP (address lists downloaded from RIPEstat once a day and matched locally) or, on mobile data, from the SIM operator.

## v1.3 — 2026-09-17

### Connection limits
- The user device limit is now enforced on the nodes as simultaneous connections, for Xray, IKEv2 (EAP) and L2TP. Devices already connected stay connected; one more waits until a place frees up. Before, it was only checked when the subscription link was fetched, so IKEv2/L2TP logins could be shared without limit.
- For Xray a device is a client IP, and the check matches the user as well as the IP, so customers behind one carrier IP don't affect each other.
- Hysteria2 (not run by the nodes) and IKEv2 in PSK mode (no per-user identity) can't be limited this way.

### Users
- Optional per-user IKEv2/L2TP password (`ipsec_password`), kept separate from the subscription secret. Users without one keep logging in as before.

### Install and management
- The dashboard's HTTPS port is configurable (`TIFUSI_DASHBOARD_HTTPS_PORT`) during install and with `tifusi panel port`; `TIFUSI_PUBLIC_URL` follows it. Answer `r` at any port prompt for a random free port.
- Choosing a port already used by the panel itself (80, or one given to another Tifusi service) is refused instead of failing at the last install step.
- `tifusi panel` gains "Remove a node from this panel"; node servers get `tifusi node` (status, logs, restart, uninstall).

### Fixes
- Nodes stayed "pending" forever on the professional (MySQL) edition: the node's full Xray version banner overflowed its column and rolled back every sync.
- A fresh local build crashed on startup with PyMySQL 1.2; it is now pinned below 1.2.
- Uninstalling left the data, certificates and MySQL files behind, which broke the next install's database login.

## v1.2 — 2026-09-15

### Dashboard redesign
- New sign-in screen with a first-time setup stepper, show-password toggle, Caps Lock warning and password strength meter.
- Dashboard: live KPI tiles with trends, traffic chart compared with the previous period, a "needs attention" list (unreachable nodes, users expiring within 3 days, limited and expired users, HTTPS off), server gauges with uptime, protocol share of today's app connections, and a live activity feed.
- Users: summary tiles, sliding status filters, top-usage board and a detail drawer with the app code and subscription link.
- Hosts: protocol constellation filter and connection cards.
- Groups: interactive access map, a clickable access matrix that edits group grants in place, and a "what does this user get" lookup.
- Nodes: rack view with per-node daily traffic, services and last-sync health.
- Cores: traffic flow of each Xray core (inbounds → routing rules → outbounds), JSON viewer, IKEv2 connection path and node assignment chips.
- Tunnels: live tunnel map and step-by-step connection tests.
- Settings: setup-health score, search, live previews for subscription links and notifications, API keys, HTTPS, admins and a confirmed danger zone.
- Command palette (Ctrl+K) for pages and create actions.
- The header shows the running version and whether it is up to date.

### Performance
- One JavaScript and one CSS bundle, each shipped with a precompressed `.gz` served by nginx `gzip_static`; API responses are gzip-compressed.

### Fixes
- The update check now compares against the highest `vX.Y` release tag instead of the first tag GitHub returns.
