<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="180" alt="لوگوی تیفوسی پنل" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<hr>

<p align="center">
  <a href="https://github.com/javadtifusi-eng/Tifusi-Panel/stargazers"><img src="https://img.shields.io/github/stars/javadtifusi-eng/Tifusi-Panel?style=flat-square&label=stars&color=F97316" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/github/v/tag/javadtifusi-eng/Tifusi-Panel?filter=v*&sort=semver&label=version&style=flat-square&color=22C55E" alt="version" />
  <img src="https://img.shields.io/github/last-commit/javadtifusi-eng/Tifusi-Panel?label=last%20update&style=flat-square&color=0EA5E9" alt="last update" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VLESS-22D3EE?style=flat-square" />
  <img src="https://img.shields.io/badge/VMess-8B5CF6?style=flat-square" />
  <img src="https://img.shields.io/badge/Trojan-EF4444?style=flat-square" />
  <img src="https://img.shields.io/badge/Shadowsocks-F59E0B?style=flat-square" />
  <img src="https://img.shields.io/badge/Hysteria2-10B981?style=flat-square" />
  <img src="https://img.shields.io/badge/L2TP%2FIPsec-3B82F6?style=flat-square" />
  <img src="https://img.shields.io/badge/IKEv2%2FIPsec-EC4899?style=flat-square" />
</p>

<p align="center">
  🇬🇧 <a href="README.md">English</a> / 🇮🇷 <b>فارسی</b> / 🇷🇺 <a href="README.ru.md">Русский</a>
</p>

<hr>

<div dir="rtl">

تیفوسی پنل یک سامانه‌ی کنترل خودمیزبان برای زیرساخت پروکسی و VPN است. یک نمونه‌ی پنل، کاربران، سیاست دسترسی و پیکربندی هسته‌ها را نگهداری می‌کند، پیکربندی هر نود را تولید می‌کند و آن را از طریق یک API مبتنی بر HTTPS و احراز هویت‌شده به تعداد دلخواه نود راه دور ارسال می‌کند. روی نودها Xray-core برای VLESS، VMess، Trojan و Shadowsocks، و strongSwan به‌همراه xl2tpd برای IKEv2/IPsec و L2TP/IPsec اجرا می‌شود. نقاط اشتراک، لینک‌های اشتراک‌گذاری، پروفایل‌های Clash و sing-box و یک پروفایل JSON ساخت‌یافته برای کلاینت Tifusi VPN ارائه می‌کنند. WireGuard پشتیبانی نمی‌شود.

</div>

<p align="center">
  <img src="docs/screenshots/live-dashboard-hosts.svg" width="100%" alt="داشبورد و هاست‌های تیفوسی پنل" />
  <br /><br />
  <img src="docs/screenshots/live-cores-tunnels.svg" width="100%" alt="هسته‌ها و تانل‌های تیفوسی پنل" />
</p>

<div dir="rtl">

## تازه‌های نسخه‌ی ۱.۲

- **طراحی تازه‌ی داشبورد.** صفحه‌ی ورود و راه‌اندازی اولیه‌ی جدید، نمای کلی زنده با فهرست «نیاز به توجه» و مقایسه‌ی ترافیک با دوره‌ی قبل، و طراحی تازه‌ی صفحه‌های کاربران، هاست‌ها، گروه‌ها، نودها، هسته‌ها، تانل‌ها و تنظیمات.
- **دسترسی‌ها در یک نگاه.** نقشه‌ی دسترسی تعاملی و جدولی که با کلیک دسترسی گروه‌ها را تغییر می‌دهد؛ نمایش مسیر ترافیک هر هسته‌ی Xray.
- **لود سریع‌تر.** یک فایل JS و یک فایل CSS، از پیش فشرده و ارسال‌شده با `gzip_static`.
- **وضعیت نسخه.** بالای پنل نسخه‌ی در حال اجرا و به‌روز بودن آن نمایش داده می‌شود.

فهرست کامل تغییرات: [CHANGELOG.md](CHANGELOG.md).

</div>

<div dir="rtl">

## معماری

### اجزا و مسیر داده

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

### مدل پیکربندی

</div>

```mermaid
flowchart TD
    Core["Core<br/>raw Xray JSON, or IKEv2 / L2TP server settings"]
    Node["Node<br/>address · agent port · API key"]
    Inbound["Inbound<br/>tag · protocol · port · transport · security"]
    Host["Host<br/>public address · port · SNI · fingerprint · remark"]
    Group["Group<br/>access boundary"]
    User["User<br/>quota · expiry · device limit · status"]
    Sub["Subscription<br/>/sub/{secret} · /code/{code}"]
    Out["Share links · Clash · sing-box<br/>app.json: ikev2 · l2tp · vless"]

    Core -->|"assigned to"| Node
    Core -->|"inbounds parsed from config"| Inbound
    Inbound -->|"published through"| Host
    Core -.->|"IKEv2 / L2TP hosts bind to the core"| Host
    Group -->|"restricts visibility of"| Host
    User -->|"member of"| Group
    User --> Sub
    Host --> Sub
    Sub --> Out
```

<div dir="rtl">

هاستی که به هیچ گروهی تعلق ندارد برای همه‌ی کاربران قابل مشاهده است. پس از اتصال هاست به یک یا چند گروه، آن هاست فقط برای اعضای همان گروه‌ها در اشتراک و پیکربندی نود درج می‌شود.

### چرخه‌ی همگام‌سازی نود

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

### امنیت ارتباط پنل و نود

- عامل نود با یک گواهی خودامضا که در نخستین اجرا تولید می‌شود (`backend/node_agent/tls.py`) روی HTTPS سرویس می‌دهد. به این ترتیب اعتبارنامه‌ها و اسرار ارسالی در مسیر رمزنگاری می‌شوند.
- هر درخواست کلید اختصاصی نود را در سرآیند `X-Node-Api-Key` حمل می‌کند. پنل گواهی عامل را اعتبارسنجی نمی‌کند، بنابراین کلید API اعتبارنامه‌ی اصلی است. TLS دوطرفه هنوز پیاده‌سازی نشده است.
- کانتینر نود با `--network host` اجرا می‌شود تا Xray بتواند پورت‌هایی را که پس از راه‌اندازی کانتینر تعریف می‌شوند اشغال کند و پورت‌های UDP 500، 4500 و 1701 روی نشانی عمومی به charon و xl2tpd برسند.

## قابلیت‌ها

- **کاربران.** ایجاد، فعال‌سازی، غیرفعال‌سازی و حذف به‌صورت تکی و گروهی. سهمیه‌ی داده با حسابرسی مصرف، انتقال خودکار به وضعیت‌های `expired` و `limited`، حساب‌های در انتظار که مدت اعتبارشان از نخستین اتصال آغاز می‌شود، محدودیت تعداد دستگاه و قالب‌های قابل استفاده‌ی مجدد.
- **هسته‌ها (Cores).** یا یک پیکربندی کامل Xray به‌صورت JSON همراه با ویرایشگرهای ساخت‌یافته برای routing، outbounds و DNS، یا پارامترهای سرور IKEv2/L2TP. هر هسته به یک یا چند نود تخصیص داده می‌شود.
- **هاست‌ها.** نقاط انتهایی عمومی برای VLESS، VMess، Trojan، Shadowsocks، Hysteria2، L2TP و IKEv2. هاست‌های مبتنی بر Xray به یک inbound استخراج‌شده از پیکربندی هسته ارجاع می‌دهند و پارامترهای transport، security و REALITY را از آن به ارث می‌برند. هاست‌های L2TP از PSK مشترک استفاده می‌کنند. هاست‌های IKEv2 سرور را با گواهی X.509 (به‌طور پیش‌فرض خودامضا، یا زنجیره‌ی صادرشده توسط CA) و هر کاربر را با EAP-MSCHAPv2 احراز هویت می‌کنند.
- **گروه‌ها.** کنترل دسترسی اعمال‌شونده. عضویت در گروه هم لینک‌های دریافتی کاربر و هم اعتبارنامه‌های درج‌شده در پیکربندی نود را تعیین می‌کند.
- **اسکنر مقصد REALITY.** تأخیر حدود ۱۶۰ دامنه‌ی SNI را اندازه‌گیری کرده و سریع‌ترین گزینه را در فرم هاست پیشنهاد می‌کند.
- **اشتراک‌ها.** URIهای `vless://`، `vmess://`، `trojan://`، `ss://` و `hysteria2://` برای هر هاست؛ پارامترهای اتصال L2TP و IKEv2؛ پروفایل `.mobileconfig` برای IKEv2؛ یک نشانی اشتراک واحد با کد QR. کلاینت‌های خانواده‌ی Clash و sing-box از روی User-Agent تشخیص داده شده و پروفایل بومی دریافت می‌کنند.
- **پروفایل Tifusi VPN.** مسیرهای `GET /sub/{secret}/app.json` و `GET /code/{code}/app.json` نقاط انتهایی IKEv2، L2TP و VLESS را همراه با سهمیه و تاریخ انقضا بازمی‌گردانند. نتایج اتصال که کلاینت به `/app/report` ارسال می‌کند برای هر کاربر و در بخش فعالیت‌های داشبورد نمایش داده می‌شود.
- **نودها.** ثبت نود یک فرمان نصب یک‌خطی متصل به کلید نود تولید می‌کند. پس از نخستین همگام‌سازی موفق، پایش سلامت و جمع‌آوری ترافیک به‌صورت پیوسته انجام می‌شود.
- **تونل‌ها.** یک سرور خارجی را از طریق یک رله در شبکه‌ی محدود منتشر می‌کند، به‌طوری که سرور خارجی به هیچ پورت ورودی باز نیاز ندارد. پنل فرمان نصب هر دو سمت را تولید کرده و بر اساس اندازه‌گیری زنده‌ی تأخیر، transport مناسب را پیشنهاد می‌کند.
- **مدیریت.** یک حساب مالک و مدیران اضافی با مجوزهای محدود. مدیران محدود فقط کاربرانی را که خود ایجاد کرده‌اند مشاهده می‌کنند. هر مدیر می‌تواند برای خودکارسازی کلید API صادر کند.
- **اعلان‌ها.** Telegram، Discord و webhook عمومی برای تغییر وضعیت کاربران و نودها.
- **تنظیمات.** نشانی عمومی، رمز مدیر، بارگذاری گواهی TLS یا صدور گواهی Let's Encrypt، و پشتیبان‌گیری و بازیابی پایگاه داده، همگی بدون استقرار مجدد.
- **رابط کاربری.** React 18، Vite و Tailwind CSS؛ بومی‌سازی فارسی (راست‌به‌چپ) و انگلیسی؛ قلم‌های Vazirmatn و Poppins به‌صورت خودمیزبان.

کارهای برنامه‌ریزی‌شده و موارد کنارگذاشته‌شده در [`ROADMAP.md`](ROADMAP.md) ثبت شده‌اند.

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

## پیش‌نیازها

### مشخصات سرور

| نقش | حداقل | پیشنهادی |
| --- | --- | --- |
| پنل | ۱ هسته‌ی CPU، ۱ گیگابایت رم، ۱۰ گیگابایت دیسک | ۲ هسته‌ی CPU، ۲ گیگابایت رم، ۲۰ گیگابایت دیسک |
| نود | ۱ هسته‌ی CPU، ۵۱۲ مگابایت رم، ۱۰ گیگابایت دیسک | ۱ هسته‌ی CPU، ۱ گیگابایت رم، ۲۰ گیگابایت دیسک |
| پنل و نود روی یک سرور | ۱ هسته‌ی CPU، ۲ گیگابایت رم، ۱۵ گیگابایت دیسک | ۲ هسته‌ی CPU، ۲ گیگابایت رم، ۲۵ گیگابایت دیسک |

اندازه‌گیری روی یک نصب در حال کار: کانتینر پنل حدود ۱۰۰ مگابایت رم، داشبورد حدود ۶ مگابایت و نود حدود ۵۰ مگابایت مصرف می‌کند و ایمیج‌ها حدود ۱ گیگابایت از دیسک را می‌گیرند. دیسک بزرگ‌تر پیشنهادی برای به‌روزرسانی ایمیج‌ها، لاگ‌ها و بکاپ‌هاست. نیاز CPU و باند نود را حجم ترافیک تعیین می‌کند، نه تعداد کاربران.

### سیستم‌عامل و معماری

- سیستم‌عامل: Ubuntu 22.04/24.04 یا Debian 11/12 (نصب‌کننده‌ها از `apt-get` استفاده می‌کنند). توزیع‌های دیگر لینوکس با نصب دستی Docker کار می‌کنند.
- معماری: x86_64 (amd64). ایمیج‌های آماده فقط برای amd64 منتشر می‌شوند؛ روی معماری‌های دیگر ایمیج‌ها به‌صورت محلی ساخته می‌شوند که بسیار بیشتر طول می‌کشد.
- دسترسی root و نشانی IPv4 عمومی.

### شبکه

- پنل: برای TLS داشتن رکورد DNS متصل به سرور توصیه می‌شود. برای گرفتن گواهی رایگان Let's Encrypt پورت ۸۰ باید در دسترس باشد.
- نود: IKEv2 به پورت‌های UDP 500 و 4500 نیاز دارد؛ L2TP علاوه بر آن به UDP 1701 و ماژول‌های کرنل `l2tp_ppp` و `ppp_generic` روی میزبان نیاز دارد.
- ساخت محلی ایمیج‌ها به دسترسی خروجی به releaseهای Xray-core در GitHub و آرشیو سورس strongSwan نیاز دارد.

## نصب

> **حداقل سرور برای پنل:** ۱ هسته‌ی CPU، ۱ گیگابایت رم، ۱۰ گیگابایت فضای دیسک.
> **برای نصب و مدیریت راحت:** ۲ هسته‌ی CPU، ۲ گیگابایت رم، ۲۰ گیگابایت فضای دیسک، با Ubuntu 22.04/24.04 یا Debian 11/12 روی x86_64.
> اگر پنل و نود روی یک سرور باشند: حداقل ۲ گیگابایت رم و ۲۵ گیگابایت فضای دیسک. جزئیات در بخش «پیش‌نیازها».

### پنل

</div>

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```

<div dir="rtl">

نصب‌کننده Docker را آماده می‌کند، مخزن را clone می‌کند، `TIFUSI_SECRET_KEY` را تولید می‌کند، در صورت تمایل برای دامنه‌ای که به سرور اشاره می‌کند گواهی Let's Encrypt صادر می‌کند و مجموعه را با Docker Compose راه‌اندازی می‌کند. فرمان مدیریتی `tifusi panel` نیز نصب می‌شود.

### نود

ابتدا نود را در صفحه‌ی **Nodes** ایجاد کنید تا کلید API آن به دست آید، سپس روی سرور نود اجرا کنید:

</div>

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
```

<div dir="rtl">

مقدار پیش‌فرض `PORT` برابر `62050` است. اسکریپت ایمیج آماده‌ی نود را دریافت می‌کند (و در صورت در دسترس نبودن، آن را به‌صورت محلی می‌سازد)، ماژول‌های کرنل لازم را بارگذاری می‌کند و کانتینر `tifusi-node` را روی شبکه‌ی میزبان اجرا می‌کند. برای ارسال پیکربندی اولیه، در پنل گزینه‌ی **Sync** را انتخاب کنید.

### راه‌اندازی اولیه

</div>

<div dir="rtl">

۱. داشبورد را باز کنید. در صورتی که هیچ مدیری وجود نداشته باشد، صفحه‌ی ورود روال راه‌اندازی را ارائه می‌کند.

۲. روی سرور پنل یک کلید راه‌اندازی یک‌بارمصرف تولید کنید:

</div>

```bash
docker exec -it tifusi-panel tifusi-cli generate-admin-key
```

<div dir="rtl">

۳. کلید را وارد کرده و نام کاربری و رمز حساب مالک را تعیین کنید.

## عملیات

فرمان `tifusi panel` بدون آرگومان یک منوی تعاملی و با آرگومان یک عملیات مشخص را اجرا می‌کند:

</div>

| Command | Action |
| --- | --- |
| `tifusi panel update` | Update to the latest release and recreate the containers |
| `tifusi panel status` | Show container state |
| `tifusi panel logs` | Follow container logs |
| `tifusi panel restart` | Restart the stack |
| `tifusi panel port` | Change the panel API and dashboard ports |
| `tifusi panel ssl` | Issue a Let's Encrypt certificate |
| `tifusi panel key` | Generate a new administrator setup key |
| `tifusi panel backup` / `tifusi panel restore` | Export or restore the database |
| `tifusi panel uninstall` | Remove the installation |

<div dir="rtl">

فرمان `tifusi` یک راه‌انداز مشترک با [Tifusi Bot](https://github.com/javadtifusi-eng/Tifusi-Bot) است: `tifusi bot` منوی نصب‌کننده‌ی ربات را باز می‌کند و `tifusi app` آخرین نسخه‌ی اپلیکیشن اندروید Tifusi VPN را همراه با لینک دانلود نمایش می‌دهد. اگر روی سرور تنها یکی از دو مؤلفه‌ی پنل یا ربات نصب باشد، فرمان `tifusi` بدون زیرفرمان همان مؤلفه را باز می‌کند؛ از این رو `tifusi update` همچنان کار می‌کند.

</div>

<div dir="rtl">

## مرجع استقرار

### Docker Compose

</div>

```bash
cp .env.example .env    # set TIFUSI_SECRET_KEY; set TIFUSI_PUBLIC_URL when behind a reverse proxy
docker compose up -d --build
```

| Service | Container | Ports |
| --- | --- | --- |
| Panel API | `tifusi-panel` | `8000` (API), `80` (ACME HTTP-01 challenge only) |
| Dashboard | `tifusi-dashboard` | `8080` (HTTP), `443` (HTTPS) |

<div dir="rtl">

داده‌های SQLite در `./data` ذخیره می‌شوند. متغیر `TIFUSI_PUBLIC_URL` نشانی پایه‌ی لینک‌های اشتراک را تعیین می‌کند؛ در صورت تنظیم‌نشدن، لینک‌ها از سرآیند `Host` درخواست ساخته می‌شوند که در حالت قرارگرفتن پنل پشت پروکسی برای کلاینت‌ها قابل دسترس نیست. این مقدار بعداً از بخش **Settings** در زمان اجرا قابل تغییر است.

### TLS روی داشبورد

کانتینر داشبورد TLS را روی پورت 443 خاتمه می‌دهد و مسیرهای `/api/`، `/sub/`، `/code/` و `/app/` را به پنل پروکسی می‌کند. فایل‌های `fullchain.pem` و `privkey.pem` از پوشه‌ی `./certs` خوانده می‌شوند و این پوشه به‌طور پیوسته پایش می‌شود؛ تغییر گواهی بدون راه‌اندازی مجدد اعمال می‌شود. گواهی را می‌توان از طریق نصب‌کننده، بخش **Settings → SSL Certificate** یا قراردادن دستی در `./certs` فراهم کرد.

### TLS مستقیم روی API

در استقرارهای بدون کانتینر داشبورد، uvicorn می‌تواند TLS را مستقیماً خاتمه دهد:

</div>

```bash
TIFUSI_SSL_CERTFILE=/app/certs/fullchain.pem
TIFUSI_SSL_KEYFILE=/app/certs/privkey.pem
```

<div dir="rtl">

مسیر `./certs:/app/certs:ro` را در `docker-compose.yml` mount کنید. هر دو متغیر باید هم‌زمان تنظیم شوند؛ تنظیم فقط یکی از آن‌ها به‌جای بازگشت به HTTP ساده، راه‌اندازی را متوقف می‌کند.

### مهاجرت پایگاه داده

طرح پایگاه داده با Alembic مدیریت می‌شود و `alembic upgrade head` در هر راه‌اندازی اجرا می‌گردد. پس از تغییر مدل، مهاجرت را تولید و بازبینی کنید:

</div>

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
```

<div dir="rtl">

SQLite برای تغییراتی از ستون‌ها که به‌صورت درجا قابل اعمال نیستند به `op.batch_alter_table(...)` نیاز دارد؛ فایل‌های تولیدشده‌ی خودکار را پیش از commit بازبینی کنید.

## توسعه

**بک‌اند**

</div>

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

<div dir="rtl">

**فرانت‌اند**

</div>

```bash
cd frontend
npm install
npm run dev
```

<div dir="rtl">

سرور توسعه‌ی Vite مسیر `/api` را به `http://localhost:8000` پروکسی می‌کند. کلید راه‌اندازی بدون Docker نیز با اجرای `python -m cli.main generate-admin-key` در پوشه‌ی `backend/` قابل تولید است.

**ایمیج عامل نود**

</div>

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
```

<div dir="rtl">

## پروژه‌های مرتبط

- [Tifusi VPN](https://github.com/javadtifusi-eng/Tifusi-VPN): کلاینت اندروید برای IKEv2 و VLESS REALITY که از طریق لینک اشتراک، کد دسترسی یا کد QR از همین پنل پیکربندی می‌شود.
- [Tifusi Bot](https://github.com/javadtifusi-eng/Tifusi-Bot): فروشگاه تلگرامی که کاربران را از طریق API پنل ایجاد می‌کند.

## اعتبار

نشان این پروژه از پروژه‌ی Tifusi-Tunnel منتقل شده است.

</div>
