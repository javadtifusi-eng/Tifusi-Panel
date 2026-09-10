# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tifusi Panel — a proxy/VPN management panel: FastAPI backend + React dashboard. Supported protocols: **VLESS, VMess, Trojan, Shadowsocks, Hysteria2, L2TP/IPsec, IKEv2/IPsec**. WireGuard was deliberately removed entirely (model, migrations, config, docs) and must not be reintroduced. Refer to this project as Tifusi Panel — don't describe it as based on or shaped like any other panel, in commits, docs, or chat.

Full user-facing docs (install script, first-run flow, Docker deployment, HTTPS setup) are in `README.md` (`README.fa.md`/`README.ru.md` are translations — keep them in sync when the English one changes). `ROADMAP.md` tracks bigger unbuilt ideas.

## Commands

**Backend dev server**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend dev server** (proxies `/api` to `http://localhost:8000`)
```bash
cd frontend
npm install
npm run dev
```

**Frontend build / typecheck** — `npm run build` runs `tsc -b && vite build`; there is no separate lint script and no backend linter/formatter configured. When verifying a frontend change, `npx tsc --noEmit` followed by `npx vite build` is the standard check.

**Database migrations** — schema changes go through Alembic, never `Base.metadata.create_all()`. The app runs `alembic upgrade head` automatically on every startup (`app/migrate.py`, called from `init_db()`).
```bash
cd backend
alembic revision --autogenerate -m "add whatever column"
```
Always read the generated file before committing — autogenerate is a first draft, not a guarantee (SQLite in particular often needs `op.batch_alter_table(...)` for column alterations). Revision IDs in this repo are random 12-char hex (`python3 -c "import secrets; print(secrets.token_hex(6))"`), not Alembic's default slug — match that convention, and find the current head with `alembic heads` or by grepping `alembic/versions/` rather than assuming the last-created file is it.

**No committed automated test suite** — there is no `pytest` (or equivalent) to run. The established verification pattern for a backend change in this repo is a throwaway script run against a freshly-migrated SQLite file: seed via the real HTTP flow (`POST /api/setup/create-admin` after inserting a `SetupKey` row, then `POST /api/auth/login`) and drive the rest through FastAPI's `TestClient`, asserting on real status codes/bodies — not mocks. Delete the scratch DB file afterward. For a frontend change, pair `tsc`/`vite build` with a Playwright screenshot (Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` in this environment) against the dev server, mocking API routes with `page.route()` as needed.

**Generate a setup key without Docker**
```bash
cd backend
python -m cli.main generate-admin-key
```

## Architecture

**Backend** (`backend/app/`): FastAPI + SQLAlchemy async (SQLite by default via `aiosqlite`), JWT auth. `app_factory.py` is where every router gets mounted — check it when adding a new one. Settings come from `app/config.py` (pydantic-settings, env prefix `TIFUSI_`, `.env` file).

**Core / Inbound / Host model** — the central design, worth understanding before touching hosts, groups, or the Xray config builder:
- A **Core** (`app/models/core.py`) is a server-side technology, typed `xray` / `l2tp` / `ikev2`. For an `xray` Core, the *entire real Xray JSON config* is stored and is the single source of truth — nothing about how an inbound runs is synthesized from a template. An **Inbound** (`app/models/inbound.py`) is parsed out of that JSON and is what a Host actually references for VLESS/VMess/Trojan/Shadowsocks (protocol, network, security, REALITY keys, flow — all read from the Inbound, not stored redundantly on the Host).
- A **Host** (`app/models/host.py`) is the client-facing endpoint. For VLESS/VMess/Trojan/Shadowsocks it just picks an Inbound and may layer client-facing overrides on top (SNI/ALPN/fingerprint/path/security/allowinsecure). For L2TP/IKEv2 it picks a Core of the matching type (these aren't Xray inbounds at all — separate standalone servers, strongSwan/xl2tpd, not started by this panel). Hysteria2 is the one exception with no Core concept yet — it keeps its own fields directly on the Host.
- `app/xray_config/builder.py` builds what's actually pushed to a node: the Core's own JSON, untouched, with each inbound's `settings.clients` populated from active users who have group access to that inbound's tag.

**Group-based access control** (`app/groups/access.py`) is an access filter, not organizational: an Inbound/Hysteria2-host with no group is global (every user gets it, in links and in the real config pushed to nodes); once it joins a group, only users sharing that group see or get it. Two independent mechanisms — VLESS/VMess/Trojan/Shadowsocks access is controlled at the Inbound level (a Group grants whole Inbound tags), Hysteria2 hosts keep a direct Group↔Host link since they aren't Inbounds.

**Nodes & the node agent** — a Node is a server that actually runs Xray-core. `backend/node_agent/` is a separate small FastAPI service meant to run there: the panel POSTs a generated config to its `/config` endpoint (per-node API key auth), it (re)starts `xray run`, reports back via `/health`; real per-user traffic is pulled from Xray's own stats API on an interval (`app/traffic/sync.py`, `traffic_sync_interval_seconds`) — this same cycle also enforces `expired`/`limited` status transitions and rolls a daily total into `traffic_snapshots` for the dashboard's traffic chart. `backend/tunnel_agent/` is a *separate, vendored Go project* (its own `go.mod`/binary) for the reverse-tunnel feature — the panel never talks to it as a managed agent, it only generates a correct silent install command per side (`app/tunnels/config.py`) matching that binary's own documented config shape.

**Auth** — `app/dependencies.py`'s `get_current_admin` accepts either a JWT (normal login) or an API key (`app/models/api_key.py`, prefixed `tifusi_`, stored only as a sha256 hash — these are high-entropy random tokens so a fast hash is fine, unlike passwords). An API key resolves to its owning admin's *current* permissions on every request, not a snapshot from creation time. `require_permission(scope)` is the per-router alternative to plain `get_current_admin`, checking a coarse per-admin scope list (`app/permissions.py`'s `PERMISSION_SCOPES`) — the owner account is never restricted, and `permissions=None` (every admin created before this existed) means unrestricted.

**Frontend** (`frontend/src/`): React + Vite + Tailwind, bilingual fa/en. Two app-wide React contexts wrap everything from `App.tsx`: `i18n/LangContext.tsx` (`useLang()` → `t`, `dir`, `align`, all strings from the single `i18n/dict.ts` — every new UI string needs both a `fa` and `en` key) and `theme/ThemeContext.tsx` (`useTheme()` → dark/light, persisted to `localStorage`, toggled via a `data-theme` attribute on `<html>`). Colors are never referenced as raw Tailwind classes (`bg-slate-950`, `border-white/10`, etc.) — they go through semantic tokens defined in `tailwind.config.js` and backed by CSS custom properties in `index.css` (`bg-surface`, `text-muted`, `border-subtle`, `text-danger`, …), each with a dark value and a `[data-theme="light"]` override, so a component never needs to know which theme is active. The cyan brand accent (`ACCENT = '#22D3EE'`, also used directly as Tailwind `cyan-*` classes for borders/solid buttons/status dots) is the one deliberate exception — it's used unthemed since it reads fine on both a near-black and a white background. All pages live flat in `pages/`, switched by `Dashboard.tsx`'s own tab state (not a router).

## Conventions worth preserving

- Comments explain *why*, not what — a hidden constraint, a subtle invariant, a workaround for a specific bug. Match that density; don't add narrative comments describing what code obviously does.
- RTL is handled with `dir === 'rtl' ? ... : ...` conditionals inline in components (matching the existing pattern throughout), not Tailwind's logical-property classes.
- When a many-to-many relationship is assigned on a brand-new SQLAlchemy object before `db.add()`, do it before adding to the async session — setting the collection after can trigger a lazy-load `MissingGreenlet` error under async.
