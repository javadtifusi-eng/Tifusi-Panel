# Changelog

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
