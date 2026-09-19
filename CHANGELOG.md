# Changelog

## v1.4.1 — 2026-09-18

### Subscription page
- QR codes are dark on white again. The light-on-dark codes couldn't be read by the iPhone camera and many scanner apps.
- Redesigned in the panel's own look, with the Tifusi logo, a data-usage bar, a direct download of the Tifusi VPN Android app and a one-tap iPhone/Mac profile button.

### REALITY scanner
- Runs on the node itself. It finds candidate sites in the node's own datacenter from their certificates (or uses the built-in list, or names you type), keeps those with TLS 1.3 and HTTP/2, and proves the best ones with a real REALITY connection per fingerprint: each of chrome, firefox, safari, ios, android, edge, 360, qq, random and randomized is marked by whether a page actually loaded through it.
- Checks from probe servers inside Iran (check-host.net) whether each finalist and the node's own address are reachable there; filtered names are listed last.
- Each working fingerprint shows its real ping (median of three requests after a warm-up, timed one fingerprint at a time). The fastest and slowest are only called out when the gap is real — usually they are within a few milliseconds of each other.
- Real ping to each target, measured from the node by IP after the scan's burst of checks: median of five TCP connects and three TLS handshakes. Targets are ranked by being open from Iran, working with chrome, then the shortest handshake — REALITY waits on it for every new connection.
- **New server (before it's a node)** replaces *My own sites*: the panel gives a one-line command that runs the scanner on a server that isn't a node yet and reports back, so its targets are known before it's added.
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

### Config lock
- **Settings → Config lock**, and per user in the user form: subscriptions only work in the Tifusi VPN app. The app gets the VLESS links sealed (AES-256-GCM, keyed from the secret or app code it used) and shows only server names; other clients get a placeholder "🔒 Install the Tifusi VPN app to connect"; the subscription page hides links and QR codes. IKEv2 and L2TP are unaffected.

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
