<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="180" alt="Tifusi Panel logo" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<p align="center"><b>Unified, secure control over your proxy infrastructure</b></p>

<hr>

<p align="center">
  <a href="https://github.com/javadtifusi-eng/Tifusi-Panel/stargazers"><img src="https://img.shields.io/github/stars/javadtifusi-eng/Tifusi-Panel?style=flat-square&label=stars&color=22D3EE" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/protocols-VLESS%20%7C%20Trojan%20%7C%20Hysteria2%20%7C%20L2TP%20%7C%20IKEv2-22D3EE?style=flat-square" alt="Supported protocols" />
</p>

<p align="center">
  🇬🇧 <b>English</b> / 🇮🇷 <a href="README.fa.md">فارسی</a> / 🇷🇺 <a href="README.ru.md">Русский</a>
</p>

<hr>

A proxy management panel — unified web UI + REST API, built with FastAPI and React, with its own original UI and onboarding flow. Supported protocols: **VLESS, VMess, Trojan, Shadowsocks, Hysteria2, L2TP/IPsec, IKEv2/IPsec** (no WireGuard).

## Screenshots

![Login](docs/screenshots/login.png)

![Users](docs/screenshots/users.png)

![Hosts](docs/screenshots/hosts.png)

![Groups](docs/screenshots/groups.png)

![Nodes](docs/screenshots/nodes.png)

![REALITY scanner](docs/screenshots/reality-scanner.png)

![Settings](docs/screenshots/settings.png)

![User links & QR code](docs/screenshots/user-links.png)

## What's here right now

- **Backend** (`backend/`): FastAPI + SQLAlchemy (async, SQLite by default), JWT auth, Alembic migrations.
- **Frontend** (`frontend/`): React + Vite + Tailwind, "Obsidian Glow" visual direction, bilingual (fa/en) login.
- **Users**: create/list/enable-disable/delete proxy users (one by one or in bulk), with a traffic cap and usage tracking, automatic `expired`/`limited` transitions, and saved **user templates** (a name, data limit, expiry-in-days and group set) to apply in one click instead of retyping the same plan every time.
- **Hosts**: VLESS/VMess/Trojan/Shadowsocks/Hysteria2/L2TP/IKEv2 endpoints. VLESS/VMess/Trojan/Shadowsocks hosts pick an Inbound parsed straight out of a Core's real Xray JSON (transport/security/REALITY come from there); L2TP/IKEv2 hosts pick a Core holding the shared PSK.
- **Cores**: a Core holds either the full raw Xray config (with visual editors for routing/outbounds/DNS on top of the JSON) or the shared fields for an L2TP/IKEv2 server — and which nodes run it.
- **Groups**: real access control, not just organization — a host with no group is global (every user sees it), once it joins a group only users sharing that group can see or use it. The same rule applies to link generation and to the actual Xray config pushed to nodes.
- **REALITY scanner**: latency-tests ~160 candidate domains and recommends the fastest one as a REALITY target, right from the Hosts form.
- **Subscription links**: every user gets a `vless://`/`vmess://`/`trojan://`/`ss://`/`hysteria2://` link per host, plain connection fields (server/PSK/username/password) for L2TP/IKEv2 hosts, plus one subscription URL (`/sub/<secret>`, no admin auth needed — client apps hit it directly) with a QR code.
- **Nodes**: register a server, get an install command to launch the node agent there, then "sync" to push the generated Xray config to it and see it come back **connected** with its Xray version. Health is polled automatically afterward, and real per-user traffic is pulled from Xray's own stats API on an interval — the same cycle rolls a daily total into the dashboard's traffic chart. See [Nodes & the node agent](#nodes--the-node-agent) below for what that agent actually does and its current limits.
- **Tunnels**: a reverse tunnel publishes a foreign VPN server through an Iran-side relay (the foreign server dials out, so no inbound port needs to be open on it) — the panel generates a silent, config-embedded install command for each side and recommends a transport based on a live latency probe.
- **Admin accounts**: the owner can create additional admins scoped to a fixed set of permissions (users/hosts/nodes/cores/groups/tunnels/settings), and any admin can issue their own long-lived API keys for scripts/bots to use instead of a short-lived login token.
- **Webhooks & Telegram**: get notified (via a JSON POST to your own URL, or a Telegram chat) on user created/expired/limited and node connected/disconnected.
- **Settings**: change the panel's public URL and the admin password at runtime, upload a TLS cert, one-click database backup/restore — all from the dashboard, no redeploy.
- **Light/dark theme**: a toggle next to the language switcher, persisted per browser.
- **Docker**: `docker-compose.yml` runs the panel + dashboard. The node agent (`backend/node_agent/`) is built and run separately, once per node — see below.

See `ROADMAP.md` for what's not built yet and some bigger ideas being considered.

## Quick install

**Panel** (the server that'll run the dashboard/API):
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```
Installs Docker automatically if it's missing (via the official `get.docker.com` script), clones the repo, optionally gets a free Let's Encrypt certificate if you have a domain pointing at the server (so the panel serves HTTPS directly, no reverse proxy needed), and brings the panel up with Docker Compose. The admin account itself is created afterward from the browser's login page — see the first-run flow below.

**Node** (any server that'll actually run Xray-core — create the node from the panel's Nodes page first to get its API key):
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
```
Builds and runs just the node agent — no full panel, no database, nothing else on that machine.

Both scripts check for Docker first and install it automatically via the official `get.docker.com` script if it's missing.

## The first-run flow (manual / no install.sh)

Instead of sending you to documentation to find a CLI command, the login page shows it directly, with a copy button:

1. Start the stack: `docker compose up -d`
2. Open the panel — since no admin exists yet, it shows the **first-time setup** card with a button that copies the exact command to run (hover it to see the command itself).
3. Run the copied command in your server's terminal:
   ```bash
   docker exec -it tifusi-panel tifusi-cli generate-admin-key
   ```
4. Paste the printed key back into the same card, pick a username/password, and the owner admin account is created — no separate page, no leaving the browser.

`install.sh` above brings the panel up through step 1 for you; from there it's steps 2-4 in your browser.

## Nodes & the node agent

A Node is a server that actually runs Xray-core. `backend/node_agent/` is a small FastAPI service meant to run on that server: the panel POSTs a generated Xray config to its `/config` endpoint (authenticated with a per-node API key), it (re)starts `xray run -config ...`, and reports back through `/health`.

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
docker run -d --name tifusi-node --restart unless-stopped \
  -p 62050:62050 -e TIFUSI_NODE_API_KEY=<from the panel's "دستور نصب" button> \
  tifusi-node-agent
```

The node agent's Dockerfile downloads the real Xray-core binary from its GitHub releases at build time — that step couldn't be verified inside the sandboxed session this project was built in (outbound GitHub access was blocked there), so **build and run it on a real machine before trusting it in production**. Everything else (config generation, the panel↔agent HTTP contract, status reporting) was verified end-to-end there using a stand-in binary.

Only VLESS and Trojan hosts get pushed into the Xray config itself — Hysteria2 isn't part of Xray-core at all (it's a separate server), and L2TP/IKEv2 are handled by strongSwan/xl2tpd instead. All three are skipped here rather than given a broken inbound.

## Local development

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
The Vite dev server proxies `/api` to `http://localhost:8000`.

**Generate a setup key without Docker**
```bash
cd backend
python -m cli.main generate-admin-key
```

## Database migrations

Schema changes go through Alembic (`backend/alembic/`), not `Base.metadata.create_all()` — the app runs `alembic upgrade head` automatically on every startup (`app/migrate.py`, called from `init_db()`), so a normal deploy always ends up on the latest schema without a manual step and without ever needing to drop the database.

When a model changes, generate the migration and commit it alongside the model change:
```bash
cd backend
alembic revision --autogenerate -m "add whatever column"
```
Always read the generated file before committing — autogenerate is a good first draft, not a guarantee, especially for anything SQLite handles awkwardly (e.g. altering an existing column may need `op.batch_alter_table(...)`).

## Docker deployment

```bash
cp .env.example .env   # set a real TIFUSI_SECRET_KEY, and TIFUSI_PUBLIC_URL if behind a proxy
docker compose up -d --build
```

- Panel API: `http://localhost:8000`
- Dashboard: `http://localhost:8080`
- SQLite data persists in `./data`

Set `TIFUSI_PUBLIC_URL` (e.g. `https://your-domain.example`) once the panel sits behind Docker/a proxy — without it, subscription URLs are built from the request's Host header, which is an internal container hostname there, not something a client can reach. This env var is only the bootstrap default: an admin can view and change it any time from the panel's own Settings page (also where the admin password gets changed), no redeploy needed.

### HTTPS on the dashboard (recommended, no separate reverse proxy needed)

The `dashboard` container (the one you actually open in a browser) can terminate TLS itself on port 443 and proxy `/api/` and `/sub/` through to the panel internally — this is exactly what `install.sh`'s domain/Let's Encrypt step sets up for you. Two other ways to turn it on without reinstalling:

- **From the panel itself**: Settings → SSL Certificate → upload your `fullchain.pem`/`privkey.pem`. Takes effect within ~15 seconds, no restart needed.
- **By hand**: drop `fullchain.pem`/`privkey.pem` into `./certs` on the host and restart (`./certs` is already mounted into both containers).

Either way, `./certs` is watched continuously — the container picks up a new (or removed) cert on its own and reloads nginx, no `nginx.conf` edits or manual restarts required.

### Direct TLS on the panel (advanced, no dashboard/reverse proxy in front)

By default the panel container runs plain HTTP internally — the dashboard's nginx is the one that should face the internet (see above). If you're not using the dashboard container at all and want uvicorn itself to terminate TLS for direct API access:

```bash
# in .env
TIFUSI_SSL_CERTFILE=/app/certs/fullchain.pem
TIFUSI_SSL_KEYFILE=/app/certs/privkey.pem
```

and mount your certs into the container (uncomment the `./certs:/app/certs:ro` line in `docker-compose.yml`). The container's entrypoint (`run.py`) picks these up automatically — nothing else changes. Both vars must be set together, or neither; setting only one fails fast at startup instead of silently falling back to HTTP.

## Design references

- Three visual directions were explored before settling on "Obsidian Glow" (the one implemented here) — see the design canvas in the project history for the alternates.
- The griffin emblem is Tifusi's own mark, reused from `Tifusi-Tunnel`'s `assets/logo-tifusi.svg`.
