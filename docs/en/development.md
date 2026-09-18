<sub>[← README](../../README.md) · [Installation](installation.md) · [Nodes](nodes.md) · [Cores & hosts](cores-and-hosts.md) · [Users](users-and-subscriptions.md) · [Resellers](resellers.md) · [Tunnels](tunnels.md) · [Telegram bot](telegram-bot.md) · [Android app](android-app.md) · [Operations](operations.md) · [Deployment](deployment.md) · [Architecture](architecture.md) · **Development**</sub>

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

## Node agent image

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
```

Planned and deliberately excluded work is tracked in [`ROADMAP.md`](../../ROADMAP.md).

---

<sub>[← Architecture](architecture.md) · [README →](../../README.md)</sub>
