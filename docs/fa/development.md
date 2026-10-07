<div dir="rtl"><sub>[→ صفحه‌ی اصلی](../../README.fa.md) · 📦 [نصب](installation.md) · 🌐 [نودها](nodes.md) · ⚛️ [هسته‌ها و هاست‌ها](cores-and-hosts.md) · 👤 [کاربران](users-and-subscriptions.md) · 💼 [نمایندگان](resellers.md) · 🚇 [تانل‌ها](tunnels.md) · 🛡️ [سپر اتصال](connection-shield.md) · ✈️ [ربات تلگرام](telegram-bot.md) · 📶 [سلامت شبکه](network-health.md) · 🎛️ [مدیریت](operations.md) · 🔁 [به‌روزرسانی امن](updates-and-rollback.md) · 🚢 [مرجع استقرار](deployment.md) · 📐 [معماری](architecture.md) · 💻 **توسعه**</sub></div>

<div dir="rtl">

# توسعه

## بک‌اند

</div>

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

<div dir="rtl">

کلید راه‌اندازی بدون Docker نیز با اجرای `python -m cli.main generate-admin-key` در پوشه‌ی `backend/` قابل تولید است.

## فرانت‌اند

</div>

```bash
cd frontend
npm install
npm run dev
```

<div dir="rtl">

سرور توسعه‌ی Vite مسیر `/api` را به `http://localhost:8000` پروکسی می‌کند.

## تست‌ها

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -q
```

پوشه‌ی `backend/tests` این‌ها را پوشش می‌دهد: لینک‌های اشتراک و متغیرهای ریمارک؛ `/sub` در همه‌ی فرمت‌ها (ساده، Clash، sing-box، صفحه‌ی HTML) همراه با گروه‌ها، فعال‌سازی on_hold و محدودیت دستگاه؛ محاسبه‌ی ترافیک با ضریب نود و آمار روزانه، انقضا و سقف حجم و ریست دوره‌ای؛ سهمیه‌ی نماینده‌ها؛ چرخه‌ی کاربر و تانل‌ها از طریق API؛ پورت‌های رزرو؛ اعتبارسنجی و برگشت کانفیگ در ایجنت نود (با باینری‌های ساختگی `xray`، `hysteria`، `swanctl` و `xl2tpd`)؛ اسکریپت‌های آپدیت تانل و نود (که واقعاً با `systemctl` و `docker` ساختگی اجرا می‌شوند)؛ و زنجیره‌ی مایگریشن — یک head، برگشت‌پذیری مراحل اخیر، و یکی بودن مدل‌ها با اسکیمای تازه مایگریت‌شده؛ پس تغییر مدل بدون مایگریشن همین‌جا شکست می‌خورد.

فایل `tests/conftest.py` به هر تست یک دیتابیس SQLite تازه مایگریت‌شده (`db`، بین تست‌ها پاک می‌شود) و یک `client` از اپ واقعی بدون حلقه‌های پس‌زمینه می‌دهد؛ `tests/factories.py` هسته، inbound، هاست و کاربر می‌سازد. با هر تغییر رفتار یک تست اضافه کنید.

### CI

- `.github/workflows/tests.yml` با هر push و pull request تست‌های بک‌اند و type check و بیلد داشبورد (`npm run build`) را اجرا می‌کند.
- ساخت ایمیج‌ها (`build-images.yml` در ریپوی عمومی) همین بررسی‌ها را روی دقیقاً همان سورسی که قرار است منتشر شود اجرا می‌کند و اگر شکست بخورند هیچ ایمیجی نمی‌سازد؛ پس هیچ چیز تست‌نشده به `:latest` نمی‌رسد.

## ایمیج عامل نود

</div>

```bash
docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend
```

<div dir="rtl">

کارهای برنامه‌ریزی‌شده و موارد کنارگذاشته‌شده در [`ROADMAP.md`](../../ROADMAP.md) ثبت شده‌اند.

</div>

---

<div dir="rtl"><sub>[→ معماری](architecture.md) · [صفحه‌ی اصلی ←](../../README.fa.md)</sub></div>
