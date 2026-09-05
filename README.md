# Tifusi Panel

A proxy management panel — unified web UI + REST API, built with FastAPI and React. Same architectural pattern as PasarGuard (Python/FastAPI backend, React dashboard, Docker deployment), original UI and onboarding flow. Supported protocols: **VLESS, Trojan, WireGuard, Hysteria2** (no VMess or Shadowsocks).

## What's here right now

- **Backend** (`backend/`): FastAPI + SQLAlchemy (async, SQLite by default), JWT auth, Alembic migrations.
- **Frontend** (`frontend/`): React + Vite + Tailwind, "Obsidian Glow" visual direction, bilingual (fa/en) login.
- **Users**: create/list/enable-disable/delete proxy users, with a traffic cap and usage tracking, and automatic `expired`/`limited` transitions once a user passes their expire date or data limit.
- **Hosts**: VLESS/Trojan/WireGuard/Hysteria2 endpoints. For VLESS/Trojan you pick the transport (tcp/ws/grpc) and security (none/tls/reality); WireGuard hosts get a server keypair + tunnel subnet.
- **Groups**: real access control, not just organization — a host with no group is global (every user sees it), once it joins a group only users sharing that group can see or use it. The same rule applies to link generation and to the actual Xray config pushed to nodes.
- **REALITY scanner**: latency-tests ~160 candidate domains and recommends the fastest one as a REALITY target, right from the Hosts form.
- **Subscription links**: every user gets a `vless://`/`trojan://`/`hysteria2://` link per host, a WireGuard `.conf` per WireGuard host (lazily provisioned with its own keypair + IP), plus one subscription URL (`/sub/<secret>`, no admin auth needed — client apps hit it directly) with a QR code.
- **Nodes**: register a server, get a `docker run` command to launch the node agent there, then "sync" to push the generated Xray config to it and see it come back **connected** with its Xray version. Health is polled automatically afterward, and real per-user traffic is pulled from Xray's own stats API on an interval. See [Nodes & the node agent](#nodes--the-node-agent) below for what that agent actually does and its current limits.
- **Settings**: change the panel's public URL and the admin password at runtime, plus one-click database backup/restore — all from the dashboard, no redeploy.
- **Docker**: `docker-compose.yml` runs the panel + dashboard. The node agent (`backend/node_agent/`) is built and run separately, once per node — see below.

Not built yet: RBAC/multi-admin, a Telegram bot, node-side WireGuard interface management (`wg-quick`) — see `ROADMAP.md` for the full list and some bigger ideas being considered.

## The first-run flow

Instead of sending you to documentation to find a CLI command, the login page shows it directly, with a copy button:

1. Start the stack: `docker compose up -d`
2. Open the panel — since no admin exists yet, it shows the **first-time setup** card with the exact command to run.
3. Run the shown command in your server's terminal:
   ```bash
   docker exec -it tifusi-panel tifusi-cli generate-admin-key
   ```
4. Paste the printed key back into the same card, pick a username/password, and the owner admin account is created — no separate page, no leaving the browser.

## Nodes & the node agent

A Node is a server that actually runs Xray-core. `backend/node_agent/` is a small FastAPI service meant to run on that server: the panel POSTs a generated Xray config to its `/config` endpoint (authenticated with a per-node API key), it (re)starts `xray run -config ...`, and reports back through `/health`.

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
docker run -d --name tifusi-node --restart unless-stopped \
  -p 62050:62050 -e TIFUSI_NODE_API_KEY=<from the panel's "دستور نصب" button> \
  tifusi-node-agent
```

The node agent's Dockerfile downloads the real Xray-core binary from its GitHub releases at build time — that step couldn't be verified inside the sandboxed session this project was built in (outbound GitHub access was blocked there), so **build and run it on a real machine before trusting it in production**. Everything else (config generation, the panel↔agent HTTP contract, status reporting) was verified end-to-end there using a stand-in binary.

Only VLESS and Trojan hosts get pushed into the Xray config itself — Hysteria2 isn't part of Xray-core at all (it's a separate server) and WireGuard is a kernel/`wg-quick` affair, neither of which this starts. Both are skipped there rather than given a broken inbound; WireGuard is still fully supported at the link-generation level (see above), just not by this node agent.

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

Set `TIFUSI_PUBLIC_URL` (e.g. `https://your-domain.example:8000`) once the panel sits behind Docker/a proxy — without it, subscription URLs are built from the request's Host header, which is an internal container hostname there, not something a client can reach. This env var is only the bootstrap default: an admin can view and change it any time from the panel's own Settings page (also where the admin password gets changed), no redeploy needed.

### Direct TLS (no reverse proxy)

By default the panel container runs plain HTTP, same as before — put nginx/Caddy in front of it for TLS. If you'd rather have uvicorn terminate TLS itself:

```bash
# in .env
TIFUSI_SSL_CERTFILE=/app/certs/fullchain.pem
TIFUSI_SSL_KEYFILE=/app/certs/privkey.pem
```

and mount your certs into the container (uncomment the `./certs:/app/certs:ro` line in `docker-compose.yml`). The container's entrypoint (`run.py`) picks these up automatically — nothing else changes. Both vars must be set together, or neither; setting only one fails fast at startup instead of silently falling back to HTTP.

## Design references

- Three visual directions were explored before settling on "Obsidian Glow" (the one implemented here) — see the design canvas in the project history for the alternates.
- The griffin emblem is Tifusi's own mark, reused from `Tifusi-Tunnel`'s `assets/logo-tifusi.svg`.
