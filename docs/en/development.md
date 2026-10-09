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

## Releasing: install-script checksums

The node and tunnel install commands the panel generates fetch `install-node.sh` and `backend/tunnel_agent/install.sh` from the public repository's tag `v<backend/VERSION>` and run them only if their SHA-256 matches `backend/app/install_checksums.json`, which ships inside the panel image. The public copies differ from this repository's, so the manifest is written from a checkout of the public repository:

`scripts/release.sh <VERSION> [--deploy]` does all of it in one go: it checks main is clean and in sync and that `CHANGELOG.md` has an `## Unreleased` section, copies the files the two repositories share into the public one and applies only this release's changes to `docs/` and to the files that deliberately differ there (`install.sh`, `manage.sh`, `install-node.sh`, `docker-compose.yml`, `backend/tunnel_agent/install.sh`), writes the install checksums from those public files, bumps the version, runs the backend tests and the frontend build, then tags and pushes both repositories, waits for the image and tunnel-binary builds and creates the GitHub release. Anything failing before the push leaves both repositories untouched. `--deploy` then runs `ops/deploy.sh`.

By hand, the checksum part is:

1. Bump `backend/VERSION` and put the release's install files into the public repository.
2. `scripts/install-checksums.sh /path/to/Tifusi-Panel` — writes the manifest for that version; commit it with the release.
3. Tag the public repository `v<VERSION>` on exactly those files, and check with `scripts/install-checksums.sh --check /path/to/Tifusi-Panel` from that tag.

The test suite fails while the manifest's version differs from `backend/VERSION`, so no image is built with stale checksums. An install script changed after its tag makes every generated command stop with "checksum mismatch" (the SSH installs then fall back to the offline bundle when set to auto).

## Production deploy

`ops/deploy.sh` (on the production server) backs up the database and files, tags the running images `:rollback`, fast-forwards `/opt/tifusi-panel` to `origin/main`, builds and starts the panel and dashboard, then checks for up to two minutes that the API and dashboard answer, nothing raised at startup and every node is still connected. If not, it starts the previous images again (data kept, as migrations only add), and restores the database backup too only if that still doesn't come up. `--dry-run` lists what would be deployed. The other `ops/` scripts run from cron: an encrypted daily off-site backup, a weekly restore test, and a 5-minute watchdog that reports to Telegram.

## Node agent image

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
```

Planned and deliberately excluded work is tracked in [`ROADMAP.md`](../../ROADMAP.md).

---

<sub>[← Architecture](architecture.md) · [README →](../../README.md)</sub>
