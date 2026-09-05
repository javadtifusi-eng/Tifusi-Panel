# Tifusi Panel

A proxy management panel — unified web UI + REST API, built with FastAPI and React. Same architectural pattern as PasarGuard (Python/FastAPI backend, React dashboard, Docker deployment), original UI and onboarding flow.

## What's here right now

This is an early, working skeleton — the login/first-run-setup screen backed by a real API, not the full dashboard yet:

- **Backend** (`backend/`): FastAPI + SQLAlchemy (async, SQLite by default), JWT auth, a CLI for generating the one-time admin setup key.
- **Frontend** (`frontend/`): React + Vite + Tailwind. The login page implements the chosen "Obsidian Glow" visual direction, bilingual (fa/en).
- **Docker**: `docker-compose.yml` builds and runs both services.

The rest of the dashboard (users, nodes, groups, settings, RBAC...) is the next phase.

## The first-run flow

Instead of sending you to documentation to find a CLI command, the login page shows it directly, with a copy button:

1. Start the stack: `docker compose up -d`
2. Open the panel — since no admin exists yet, it shows the **first-time setup** card with the exact command to run.
3. Run the shown command in your server's terminal:
   ```bash
   docker exec -it tifusi-panel tifusi-cli generate-admin-key
   ```
4. Paste the printed key back into the same card, pick a username/password, and the owner admin account is created — no separate page, no leaving the browser.

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
cp .env.example .env   # set a real TIFUSI_SECRET_KEY
docker compose up -d --build
```

- Panel API: `http://localhost:8000`
- Dashboard: `http://localhost:8080`
- SQLite data persists in `./data`

## Design references

- Three visual directions were explored before settling on "Obsidian Glow" (the one implemented here) — see the design canvas in the project history for the alternates.
- The griffin emblem is Tifusi's own mark, reused from `Tifusi-Tunnel`'s `assets/logo-tifusi.svg`.
