# Roadmap

## Done

- Setup flow: CLI-generated admin key entered straight into the login page (no docs/GitHub round-trip)
- Users, Hosts (VLESS/Trojan/WireGuard/Hysteria2), Nodes, Groups: full CRUD with a real access-control model
- REALITY target scanner: latency-tests ~160 candidate SNIs and recommends the best one
- Per-user share links, subscription URL, and QR codes
- Real Xray-core config generation, pushed to nodes through a small node agent
- Per-user WireGuard peers: lazy keypair + IP allocation, client `.conf` generation
- Real traffic accounting: the node agent reads Xray's own StatsService (`xray api statsquery`), the panel polls it on an interval and adds the deltas onto `used_traffic`
- Automatic `expired`/`limited` status transitions once a user passes their expire date or data limit, with an automatic node resync so it actually takes effect
- Settings page: admin can change the panel's public URL and their own password at runtime, no redeploy or `.env` edit needed
- Periodic node health polling: a background job GETs `/health` on every already-synced node so status recovers/degrades on its own — deliberately read-only, it never pushes `/config`, so checking on a node can't restart its live Xray process the way a real sync does
- Database backup/restore from the Settings page — download the live SQLite file, or upload one to atomically replace it (disposes the connection pool first so no in-flight connection keeps writing to the file being replaced)
- Direct TLS: `run.py` terminates HTTPS in uvicorn itself when `TIFUSI_SSL_CERTFILE`/`TIFUSI_SSL_KEYFILE` are set, for a deployment with no nginx/Caddy in front — unset (the default) keeps plain HTTP exactly as before
- Real database migrations (Alembic): `Base.metadata.create_all()` is gone — `app/migrate.py` runs `alembic upgrade head` on every startup instead, so a schema change (a new column, a new table) ships as a versioned migration instead of requiring the database to be dropped
- Multi-admin: the owner (the account created during first-run setup) can create and delete additional admin accounts from the Settings page. Every admin has full access to the panel — the only owner-only actions are managing admin accounts themselves and the owner account can't be deleted. Not a granular-permissions system, deliberately: just enough to hand someone else access without handing them your own password

## Known gaps (scoped out on purpose, not overlooked)

- Node-side WireGuard interface management (`wg-quick`) — this panel generates the client config and the peer block to paste, but doesn't touch the kernel interface itself (needs `NET_ADMIN` on the node)
- Real Xray-core binary was never fetchable in the sandbox this was built in (GitHub releases blocked) — the panel↔node-agent lifecycle was proven with a stub binary; a real deployment still needs its first real-world verification
- No per-admin permission scoping (e.g. read-only, or restricted to certain hosts/groups) — every non-owner admin has full access
- No notifications (e.g. a Telegram bot pinging users near their expire date/limit)
- No database backup/restore from the dashboard
- Mobile viewport edge case reported once, never confirmed fixed or broken

## Ideas worth building (bigger, riskier, not started)

### Live censorship radar (crowd-sourced)
Right now the REALITY scanner only sees the internet from the panel's own vantage point. The idea: have connected clients themselves run a small, silent background probe and report back — anonymously — which SNI/protocol actually works *from their specific ISP, right now*. Aggregated across users, the panel could tell that, say, one carrier just blocked a given REALITY target while another hasn't, and reconfigure each user's subscription automatically, without them noticing anything beyond "it still works."

Why nobody's built this: it needs an anonymous telemetry pipeline (no IP, no identity — otherwise the feature itself becomes a liability), per-ISP/per-moment aggregation logic, and a way to push reconfiguration to potentially huge numbers of clients. All solvable, all real engineering work.

### Domain fronting through a high-cost-to-block CDN (e.g. ArvanCloud)
Route tunnel traffic through a CDN edge that a huge share of the country's own internet already depends on (banks, government sites, etc.), so from the outside it looks like an ordinary HTTPS request to an unrelated, everyday domain. Blocking it wholesale means blocking the CDN itself — a much higher cost than blocking one VPN provider.

Needs verifying case by case: some CDNs enforce SNI/Host-header matching at the edge specifically to prevent this, so ArvanCloud (or whichever provider) has to actually be tested before betting on it, not assumed. Should always sit behind a working fallback (REALITY/WireGuard), never be the only path.

### Built-in Iran↔abroad tunnel management
A lot of users currently run a separate tunnel script (GRE/IPIP/etc., or a dedicated tool like this account's own Tifusi-Tunnel) to bridge an Iran-side server to a foreign one, entirely outside the panel. Folding that into Tifusi Panel itself — as a first-class "Tunnel" section — would mean one tool instead of two disconnected ones.

Same honest caveat as WireGuard: this is kernel/interface-level work on the node (needs `NET_ADMIN`), not just config generation, so it's a genuinely bigger lift than anything else on this list.

### Multi-exit IP rotation
Instead of one fixed foreign server IP per host, rotate a user's traffic across several exit IPs (DNS with a short TTL, a load balancer, or — going further — short-lived relays the way Tor's Snowflake does with WebRTC) so there's no single stable IP for a censor to blacklist long enough for it to matter.

This is the same "nodes" model already built here, just automated one step further: instead of an admin manually adding nodes and assigning hosts to them, the panel would rotate a user between nodes itself. Tradeoff is infrastructure cost and keeping config in sync across every exit at once — more moving parts than a single server, by design.
