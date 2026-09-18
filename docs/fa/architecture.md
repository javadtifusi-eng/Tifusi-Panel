<div dir="rtl"><sub>[→ صفحه‌ی اصلی](../../README.fa.md) · 🚀 [نصب](installation.md) · 🖥️ [نودها](nodes.md) · 🧩 [هسته‌ها و هاست‌ها](cores-and-hosts.md) · 👥 [کاربران](users-and-subscriptions.md) · 🤝 [نمایندگان](resellers.md) · 🌉 [تانل‌ها](tunnels.md) · 🤖 [ربات تلگرام](telegram-bot.md) · 📱 [اپ اندروید](android-app.md) · ⚙️ [مدیریت](operations.md) · 🐳 [مرجع استقرار](deployment.md) · 🏗️ **معماری** · 🛠️ [توسعه](development.md)</sub></div>

<div dir="rtl">

# معماری

## اجزا و مسیر داده

</div>

```mermaid
flowchart LR
    Admin(["Administrator"])

    subgraph PanelHost["Panel server · docker compose"]
        direction TB
        Dash["tifusi-dashboard<br/>nginx + React SPA<br/>TCP 443 / 8080"]
        API["tifusi-panel<br/>FastAPI · TCP 8000"]
        DB[("SQLite<br/>./data")]
        Dash -->|"/api · /sub · /code · /app"| API
        API <--> DB
    end

    subgraph NodeHost["Node server · tifusi-node · host network"]
        direction TB
        Agent["Node agent<br/>HTTPS · TCP 62050"]
        Xray["Xray-core<br/>VLESS · VMess · Trojan · SS"]
        Swan["strongSwan charon<br/>IKEv2 · EAP-MSCHAPv2"]
        L2TP["xl2tpd<br/>L2TP over IPsec"]
        Agent -->|"write config, restart"| Xray
        Agent -->|"swanctl --load-all"| Swan
        Agent -->|"apply config"| L2TP
    end

    subgraph Clients["Clients"]
        direction TB
        App["Tifusi VPN<br/>Android"]
        XC["Xray clients<br/>v2rayNG · V2Box · sing-box · Clash"]
        Native["Native IKEv2 / L2TP<br/>iOS · Android · Windows"]
    end

    Admin -->|"HTTPS"| Dash
    API -->|"POST /config<br/>POST /ipsec-config<br/>X-Node-Api-Key"| Agent
    API -.->|"GET /health · GET /stats<br/>every 30 s"| Agent

    App -->|"GET /code/{code}/app.json<br/>POST /app/report"| Dash
    XC -->|"GET /sub/{secret}"| Dash
    App ==>|"VLESS REALITY"| Xray
    App ==>|"IKEv2 · UDP 500/4500"| Swan
    XC ==>|"proxy protocols"| Xray
    Native ==>|"UDP 500/4500"| Swan
    Native ==>|"UDP 1701 in IPsec"| L2TP
```

<div dir="rtl">

فلش‌های پیوسته درخواست‌های لایه‌ی کنترل، فلش‌های نقطه‌چین پایش دوره‌ای و فلش‌های ضخیم ترافیک لایه‌ی داده را نشان می‌دهند. پنل ترافیک کاربران را عبور نمی‌دهد و کلاینت‌ها مستقیماً به نشانی نودهایی که در هاست‌ها منتشر شده‌اند متصل می‌شوند.

## چرخه‌ی همگام‌سازی نود

</div>

```mermaid
sequenceDiagram
    autonumber
    participant Admin
    participant Panel as Panel API
    participant Agent as Node agent
    participant Core as Xray / strongSwan
    participant Client

    Admin->>Panel: Create, update, reset or delete a user
    Panel->>Panel: Persist change and resolve group access
    Panel-)Agent: POST /config (rendered Xray JSON)
    Panel-)Agent: POST /ipsec-config (swanctl connections, EAP secrets, PSK, pools)
    Agent->>Core: Apply configuration
    Client->>Panel: GET /code/{code}/app.json
    Panel-->>Client: Endpoints, credentials, remaining quota and expiry
    Client->>Core: Establish tunnel
    Client-)Panel: POST /app/report (connection result)
    loop Every TIFUSI_TRAFFIC_SYNC_INTERVAL_SECONDS (default 30)
        Panel->>Agent: GET /health, GET /stats
        Agent-->>Panel: Process state and per-user traffic counters
        Panel->>Panel: Accumulate usage, transition expired / limited users
        Panel-)Agent: Resync nodes whose effective user set changed
    end
```

<div dir="rtl">

## ساختار مخزن

</div>

| Path | Contents |
| --- | --- |
| `backend/app` | FastAPI application: routers, SQLAlchemy models, Xray config builder, subscription renderers, node sync, traffic accounting |
| `backend/alembic` | Database migrations |
| `backend/cli` | `tifusi-cli`, including first-run admin key generation |
| `backend/node_agent` | Node agent service, strongSwan/xl2tpd integration, node Dockerfile |
| `backend/tunnel_agent` | Relay agent for the Tunnels feature (Go) |
| `frontend` | React dashboard and nginx image |
| `install.sh`, `install-node.sh` | Panel and node installers |
| `manage.sh` | Operations menu, installed as `/usr/local/bin/tifusi-panel` and run as `tifusi panel` |
| `scripts/tifusi` | Shared `tifusi` launcher for Tifusi Panel, Tifusi Bot and the Tifusi VPN app |
| `.github/workflows/build-images.yml` | Builds and publishes panel, dashboard and node images to GHCR |

<div dir="rtl">

داشبورد با React 18، Vite و Tailwind CSS ساخته شده، به فارسی (راست‌به‌چپ) و انگلیسی بومی‌سازی شده و از قلم‌های Vazirmatn و Poppins به‌صورت خودمیزبان استفاده می‌کند.

</div>

---

<div dir="rtl"><sub>[→ مرجع استقرار](deployment.md) · [توسعه ←](development.md)</sub></div>
