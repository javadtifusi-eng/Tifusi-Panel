<div dir="rtl"><sub>[→ صفحه‌ی اصلی](../../README.fa.md) · [نصب](installation.md) · [نودها](nodes.md) · [هسته‌ها و هاست‌ها](cores-and-hosts.md) · [کاربران](users-and-subscriptions.md) · [نمایندگان](resellers.md) · [تانل‌ها](tunnels.md) · [ربات تلگرام](telegram-bot.md) · [اپ اندروید](android-app.md) · [مدیریت](operations.md) · **مرجع استقرار** · [معماری](architecture.md) · [توسعه](development.md)</sub></div>

<div dir="rtl">

# مرجع استقرار

این صفحه اجرای دستی مجموعه را شرح می‌دهد. [نصب‌کننده](installation.md) همه‌ی این مراحل را خودکار انجام می‌دهد.

## Docker Compose

</div>

```bash
cp .env.example .env    # set TIFUSI_SECRET_KEY; set TIFUSI_PUBLIC_URL when behind a reverse proxy
docker compose up -d --build
```

<div dir="rtl">

| سرویس | کانتینر | پورت‌ها |
| --- | --- | --- |
| API پنل | `tifusi-panel` | `8000` (API)، `80` (فقط چالش ACME HTTP-01) |
| داشبورد | `tifusi-dashboard` | `8080` (HTTP)، `443` (HTTPS) |

همه‌ی پورت‌های بالا هنگام نصب پرسیده می‌شوند و بعداً با `tifusi panel port` قابل تغییرند؛ در هر پرسش می‌توانید `r` بزنید تا یک پورت آزاد تصادفی انتخاب شود. تنها استثنا پورت `80` است که ثابت می‌ماند، چون پنل چالش HTTP-01 لتزاینکریپت را روی آن پاسخ می‌دهد. پورت HTTPS با `TIFUSI_DASHBOARD_HTTPS_PORT` تعیین می‌شود و پیش‌فرض آن `443` است؛ برای سروری که پشت پروکسی Cloudflare قرار دارد یکی از `2053`، `2083`، `2087`، `2096` یا `8443` را بگذارید و `TIFUSI_PUBLIC_URL` را هم متناسب با آن به‌روز کنید، چون نشانی `https://host` بدون پورت فقط `443` را می‌رساند.

داده‌های SQLite در `./data` ذخیره می‌شوند. متغیر `TIFUSI_PUBLIC_URL` نشانی پایه‌ی لینک‌های اشتراک را تعیین می‌کند؛ در صورت تنظیم‌نشدن، لینک‌ها از سرآیند `Host` درخواست ساخته می‌شوند که هنگام قرار گرفتن پنل پشت پروکسی برای کلاینت‌ها قابل دسترس نیست. این مقدار بعداً از بخش **تنظیمات** در زمان اجرا قابل تغییر است.

## TLS روی داشبورد

کانتینر داشبورد TLS را روی پورت 443 خاتمه می‌دهد و مسیرهای `/api/`، `/sub/`، `/code/` و `/app/` را به پنل پروکسی می‌کند. فایل‌های `fullchain.pem` و `privkey.pem` از پوشه‌ی `./certs` خوانده می‌شوند و این پوشه به‌طور پیوسته پایش می‌شود؛ تغییر گواهی بدون راه‌اندازی دوباره اعمال می‌شود. گواهی را می‌توان از طریق نصب‌کننده، بخش **تنظیمات ← گواهی SSL** یا قرار دادن دستی در `./certs` فراهم کرد.

## TLS مستقیم روی API

در استقرارهای بدون کانتینر داشبورد، uvicorn می‌تواند TLS را مستقیماً خاتمه دهد:

</div>

```bash
TIFUSI_SSL_CERTFILE=/app/certs/fullchain.pem
TIFUSI_SSL_KEYFILE=/app/certs/privkey.pem
```

<div dir="rtl">

مسیر `./certs:/app/certs:ro` را در `docker-compose.yml` متصل (mount) کنید. هر دو متغیر باید هم‌زمان تنظیم شوند؛ تنظیم فقط یکی از آن‌ها به‌جای بازگشت به HTTP ساده، راه‌اندازی را متوقف می‌کند.

## مهاجرت پایگاه داده

طرح پایگاه داده با Alembic مدیریت می‌شود و `alembic upgrade head` در هر راه‌اندازی اجرا می‌شود. پس از تغییر مدل، مهاجرت را تولید و بازبینی کنید:

</div>

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
```

<div dir="rtl">

SQLite برای تغییراتی از ستون‌ها که به‌صورت درجا قابل اعمال نیستند به `op.batch_alter_table(...)` نیاز دارد؛ فایل‌های تولیدشده‌ی خودکار را پیش از commit بازبینی کنید.

</div>

---

<div dir="rtl"><sub>[→ مدیریت](operations.md) · [معماری ←](architecture.md)</sub></div>
