# Changelog

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
