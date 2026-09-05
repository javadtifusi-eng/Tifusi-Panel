# Tifusi Panel

A proxy management panel — unified web UI + REST API, built with FastAPI and React. Same architectural pattern as PasarGuard (Python/FastAPI backend, React dashboard, Docker deployment), original UI and onboarding flow. Supported protocols: **VLESS, Trojan, WireGuard, Hysteria2** (no VMess or Shadowsocks).

## What's here right now

- **Backend** (`backend/`): FastAPI + SQLAlchemy (async, SQLite by default), JWT auth.
- **Frontend** (`frontend/`): React + Vite + Tailwind, "Obsidian Glow" visual direction, bilingual (fa/en) login.
- **Users**: create/list/enable-disable/delete proxy users, with a traffic cap and usage tracking.
- **Hosts**: VLESS/Trojan/WireGuard/Hysteria2 endpoints. For VLESS/Trojan you pick the transport (tcp/ws/grpc) and security (none/tls/reality).
- **REALITY scanner**: latency-tests ~160 candidate domains and recommends the fastest one as a REALITY target, right from the Hosts form.
- **Subscription links**: every user gets a `vless://`/`trojan://`/`hysteria2://` link per host plus one subscription URL (`/sub/<secret>`, base64-encoded, no admin auth needed — client apps hit it directly) with a QR code.
- **Nodes**: register a server, get a `docker run` command to launch the node agent there, then "sync" to push the generated Xray config to it and see it come back **connected** with its Xray version. See [Nodes & the node agent](#nodes--the-node-agent) below for what that agent actually does and its current limits.
- **Docker**: `docker-compose.yml` runs the panel + dashboard. The node agent (`backend/node_agent/`) is built and run separately, once per node — see below.

Not built yet: groups, RBAC/multi-admin, settings page, Telegram bot, per-user WireGuard keys (see below).

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

Only VLESS and Trojan hosts get pushed into the Xray config — Hysteria2 isn't part of Xray-core at all (it's a separate server), and WireGuard needs a per-user keypair + allocated tunnel IP that nothing generates yet. Both are skipped rather than given a broken config.

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

## Docker deployment

```bash
cp .env.example .env   # set a real TIFUSI_SECRET_KEY, and TIFUSI_PUBLIC_URL if behind a proxy
docker compose up -d --build
```

- Panel API: `http://localhost:8000`
- Dashboard: `http://localhost:8080`
- SQLite data persists in `./data`

Set `TIFUSI_PUBLIC_URL` (e.g. `https://your-domain.example:8000`) once the panel sits behind Docker/a proxy — without it, subscription URLs are built from the request's Host header, which is an internal container hostname there, not something a client can reach.

## Design references

- Three visual directions were explored before settling on "Obsidian Glow" (the one implemented here) — see the design canvas in the project history for the alternates.
- The griffin emblem is Tifusi's own mark, reused from `Tifusi-Tunnel`'s `assets/logo-tifusi.svg`.
