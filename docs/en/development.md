<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · 🔀 [Domain rotation](domain-rotation.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 [Safe updates](updates-and-rollback.md) · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 **Development**</sub>

# Development

## Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

A setup key can be generated without Docker with `python -m cli.main generate-admin-key` from `backend/`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server proxies `/api` to `http://localhost:8000`.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -q
```

`backend/tests` covers share links and remark variables; `/sub` in every format (plain, Clash, sing-box, the HTML page) with groups, on-hold activation and device limits; traffic accounting with node multipliers and snapshots, expiry and limit enforcement and periodic resets; reseller quotas; the user lifecycle and tunnels over the admin API; reserved ports; the node agent's config validation and rollback (against fake `xray`, `hysteria`, `swanctl` and `xl2tpd` binaries); the tunnel and node update scripts (run for real against a fake `systemctl` and `docker`); and the migration chain — a single head, reversible recent steps, and models identical to the freshly migrated schema, so a model change without its migration fails here.

`tests/conftest.py` gives each test a freshly migrated SQLite `db` (wiped between tests) and an ASGI `client` for the real app without its background loops; `tests/factories.py` builds cores, inbounds, hosts and users. Add a test with every behaviour change.

### CI

- `.github/workflows/tests.yml` runs the backend suite and the dashboard's type check and build (`npm run build`) on every push and pull request.
- The image build (`build-images.yml` in the public repository) runs the same checks on the exact source it is about to publish and builds no image when they fail, so nothing reaches `:latest` untested.

## Node agent image

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
```

Planned and deliberately excluded work is tracked in [`ROADMAP.md`](../../ROADMAP.md).

---

<sub>[← Architecture](architecture.md) · [README →](../../README.md)</sub>
