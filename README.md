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

Tifusi Panel is a self-hosted proxy management panel: a web dashboard plus a REST API, built on FastAPI and React. It supports VLESS, VMess, Trojan, Shadowsocks, Hysteria2, L2TP/IPsec and IKEv2/IPsec. No WireGuard.

## Screenshots

![Login](docs/screenshots/login.png)

![Users](docs/screenshots/users.png)

![Hosts](docs/screenshots/hosts.png)

![Groups](docs/screenshots/groups.png)

![Nodes](docs/screenshots/nodes.png)

![REALITY scanner](docs/screenshots/reality-scanner.png)

![Settings](docs/screenshots/settings.png)

![User links & QR code](docs/screenshots/user-links.png)

## Features

- **Backend** in `backend/`: FastAPI, async SQLAlchemy (SQLite by default), JWT auth, Alembic migrations.
- **Frontend** in `frontend/`: React + Vite + Tailwind, dark/light theme, bilingual (Persian/English) UI throughout.
- **Users** — create, list, enable/disable and delete proxy users one at a time or in bulk. Traffic caps and usage tracking, automatic `expired`/`limited` transitions, on-hold accounts whose countdown starts on first connect instead of at creation, an optional per-user device limit, and saved templates so you're not retyping the same plan every time.
- **Hosts** for VLESS, VMess, Trojan, Shadowsocks, Hysteria2, L2TP and IKEv2. The Xray-backed protocols pick an Inbound parsed straight out of a Core's real Xray config — transport, security and REALITY keys all come from there. L2TP/IKEv2 hosts pick a Core that holds the shared PSK.
- **Cores** hold either a full raw Xray JSON config (with visual editors for routing, outbounds and DNS on top of it) or the shared settings for an L2TP/IKEv2 server, plus which nodes run it.
- **Groups** are real access control, not just labels. A host with no group is visible to everyone; once it joins a group, only users in that group can see or use it — in their links and in the actual config pushed to nodes.
- **REALITY scanner** — tests around 160 candidate domains for latency and suggests the fastest one right from the Hosts form.
- **Subscription links** — a `vless://`, `vmess://`, `trojan://`, `ss://` or `hysteria2://` link per host, plain connection details for L2TP/IKEv2, and one subscription URL with a QR code that client apps hit directly (Clash and sing-box clients get a proper config instead of a raw link list).
- **Nodes** — register a server, run the install command it gives you, hit Sync, and it comes back connected with its Xray version attached. After that, health checks and traffic collection run on their own.
- **Tunnels** — publish a foreign VPN server through an Iran-side relay so the foreign server never needs an open inbound port. The panel builds a silent install command for each side and suggests a transport based on a live latency check.
- **Admin accounts** — the owner can create additional admins with limited permissions, and each admin can issue API keys for scripts and bots instead of using a login token. Admins with limited access only see the users they created themselves.
- **Notifications** — Telegram, Discord or a plain webhook, your pick (or all three), for user and node events.
- **Settings** — public URL and admin password from the dashboard, TLS certificate upload, one-click backup and restore. No redeploy needed for any of it.

See `ROADMAP.md` for what's still missing and what's being considered next.

## Quick install

**Panel** — the server that'll host the dashboard and API:
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```
This installs Docker if you don't have it, clones the repo, offers to grab a free Let's Encrypt certificate if you point a domain at the server, and brings everything up with Docker Compose. You create the admin account afterward from the browser — see below.

**Node** — any server that'll actually run Xray. Create the node in the panel's Nodes page first to get its API key:
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
```
This only sets up the node agent — no panel, no database, nothing else on that machine.

Both scripts install Docker for you if it's missing.

## First-run setup

No documentation hunt needed — the login page shows you the exact command to run, with a copy button.

1. Start the stack: `docker compose up -d`
2. Open the panel. With no admin account yet, it shows a first-time setup card and a command to copy.
3. Run that command on the server:
   ```bash
   docker exec -it tifusi-panel tifusi-cli generate-admin-key
   ```
4. Paste the key back into the same card, pick a username and password, done.

`install.sh` handles step 1 for you — steps 2 through 4 happen in the browser.

## Nodes and the node agent

A node is a server that runs Xray. `backend/node_agent/` is the small FastAPI service that goes on it: the panel posts a generated config to its `/config` endpoint, authenticated with a per-node API key, and the agent restarts Xray with it and reports back on `/health`.

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
docker run -d --name tifusi-node --restart unless-stopped \
  -p 62050:62050 -e TIFUSI_NODE_API_KEY=<from the panel's node-install command> \
  tifusi-node-agent
```

The agent's Dockerfile pulls the real Xray-core binary from its GitHub release at build time, so building it needs outbound internet access.

Hysteria2 isn't part of Xray-core — it runs as its own server — and L2TP/IKEv2 go through strongSwan and xl2tpd instead. All three are left out of the Xray config the panel pushes rather than forced into a broken inbound.

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

Schema changes go through Alembic, not `create_all()`. The app runs `alembic upgrade head` on every startup, so a normal deploy always lands on the latest schema with no manual step.

When you change a model, generate the migration alongside it:
```bash
cd backend
alembic revision --autogenerate -m "add whatever column"
```
Read the generated file before committing it — autogenerate gets you most of the way there but SQLite needs `op.batch_alter_table(...)` for some column changes it can't do inline.

## Docker deployment

```bash
cp .env.example .env   # set a real TIFUSI_SECRET_KEY, and TIFUSI_PUBLIC_URL if behind a proxy
docker compose up -d --build
```

- Panel API: `http://localhost:8000`
- Dashboard: `http://localhost:8080`
- SQLite data lives in `./data`

Set `TIFUSI_PUBLIC_URL` once the panel sits behind a proxy — without it, subscription URLs get built from the request's Host header, which inside a container is an internal name a client can't reach. It's only a bootstrap default though; you can change it any time from Settings without redeploying.

### HTTPS on the dashboard (recommended)

The `dashboard` container can terminate TLS itself on port 443 and proxy `/api/` and `/sub/` to the panel internally. `install.sh`'s domain/Let's Encrypt step sets this up automatically. Two other ways to enable it later:

- From the panel: Settings → SSL Certificate → upload `fullchain.pem` and `privkey.pem`. Live within about 15 seconds.
- By hand: drop the same two files into `./certs` on the host.

Either way, `./certs` is watched continuously, so nginx picks up a new or removed cert on its own.

### Direct TLS on the panel (advanced)

If you're skipping the dashboard container entirely and want uvicorn to terminate TLS itself:

```bash
# in .env
TIFUSI_SSL_CERTFILE=/app/certs/fullchain.pem
TIFUSI_SSL_KEYFILE=/app/certs/privkey.pem
```

Uncomment the `./certs:/app/certs:ro` line in `docker-compose.yml` too. Both variables need to be set together — setting only one fails fast at startup instead of quietly falling back to plain HTTP.

## Credits

The griffin emblem is Tifusi's own mark, carried over from `Tifusi-Tunnel`.
