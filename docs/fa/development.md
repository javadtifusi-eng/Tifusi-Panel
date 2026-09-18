<div dir="rtl"><sub>[→ صفحه‌ی اصلی](../../README.fa.md) · [نصب](installation.md) · [نودها](nodes.md) · [هسته‌ها و هاست‌ها](cores-and-hosts.md) · [کاربران](users-and-subscriptions.md) · [نمایندگان](resellers.md) · [تانل‌ها](tunnels.md) · [ربات تلگرام](telegram-bot.md) · [اپ اندروید](android-app.md) · [مدیریت](operations.md) · [مرجع استقرار](deployment.md) · [معماری](architecture.md) · **توسعه**</sub></div>

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
