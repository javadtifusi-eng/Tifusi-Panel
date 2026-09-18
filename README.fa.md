<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="180" alt="لوگوی تیفوسی پنل" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<p align="center"><b>سامانه‌ی خودمیزبان مدیریت زیرساخت پروکسی و VPN</b></p>

<hr>

<p align="center">
  <a href="https://github.com/javadtifusi-eng/Tifusi-Panel/stargazers"><img src="https://img.shields.io/github/stars/javadtifusi-eng/Tifusi-Panel?style=flat-square&label=stars&color=F97316" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/github/v/tag/javadtifusi-eng/Tifusi-Panel?filter=v*&sort=semver&label=version&style=flat-square&color=22C55E" alt="version" />
  <a href="https://t.me/javadheydeari"><img src="https://img.shields.io/badge/Support-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram support" /></a>
  <img src="https://img.shields.io/github/last-commit/javadtifusi-eng/Tifusi-Panel?label=last%20update&style=flat-square&color=0EA5E9" alt="last update" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-source--available-DC2626?style=flat-square" alt="license" /></a>
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
  <img src="docs/brand/gb.png" height="14" alt="" /> <a href="README.md">English</a> &nbsp;·&nbsp; <img src="docs/brand/ir.png" height="14" alt="" /> <b>فارسی</b> &nbsp;·&nbsp; <img src="docs/brand/ru.png" height="14" alt="" /> <a href="README.ru.md">Русский</a>
</p>

<hr>

<div dir="rtl">

تیفوسی پنل کاربران، سیاست دسترسی و پیکربندی سرورها را از یک داشبورد مدیریت می‌کند و آن را به هر تعداد نود ارسال می‌کند. روی نودها Xray-core برای VLESS، VMess، Trojan و Shadowsocks، و strongSwan به‌همراه xl2tpd برای IKEv2 و L2TP، در کنار هم روی یک سرور اجرا می‌شوند.

</div>

<p align="center">
  <img src="docs/screenshots/live-dashboard-hosts.svg" width="100%" alt="داشبورد و هاست‌های تیفوسی پنل" />
</p>

<div dir="rtl">

## ویژگی‌های شاخص

| | |
| --- | --- |
| **دو هسته روی یک نود** | هر نود هم‌زمان یک هسته‌ی Xray و یک هسته‌ی IPsec (IKEv2 یا L2TP) اجرا می‌کند؛ یک سرور هم به کاربران پروکسی و هم به کاربران VPN بومی سرویس می‌دهد. |
| **محدودیت دستگاه روی نود** | اتصال هم‌زمان برای Xray، IKEv2 و L2TP روی خود نود کنترل می‌شود، نه اینکه فقط در پنل شمرده شود. |
| **نمایندگان** | حساب‌های ورود جداگانه با پروتکل‌ها، سقف کاربر و سهمیه‌ی حجم مخصوص به خود، بدون دسترسی به سرورها. |
| **تانل‌ها** | انتشار سرور خارج از طریق سرور ایران، همراه با دستور نصب آماده برای هر دو سمت. |
| **ربات تلگرام و اپ اندروید** | فروش خودکار اشتراک با Tifusi Bot و اتصال با یک لمس در Tifusi VPN. |

## شروع سریع

**پنل**

</div>

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
```

<div dir="rtl">

برای نسخه‌ی حرفه‌ای با MySQL، عبارت `-- --pro` را به انتهای دستور اضافه کنید. پیش‌نیازها، راه‌اندازی اولیه و نسخه‌ها در بخش [نصب](docs/fa/installation.md) آمده است.

**نود** — ابتدا نود را در صفحه‌ی **نودها** ایجاد کنید، سپس روی سرور نود اجرا کنید:

</div>

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]
```

<div dir="rtl">

## مستندات

| بخش | محتوا |
| --- | --- |
| [نصب](docs/fa/installation.md) | مشخصات سرور، نسخه‌ی عادی و حرفه‌ای، راه‌اندازی اولیه |
| [نودها](docs/fa/nodes.md) | دو هسته روی یک نود، افزودن و حذف نود، همگام‌سازی، محدودیت دستگاه |
| [هسته‌ها، هاست‌ها و گروه‌ها](docs/fa/cores-and-hosts.md) | هسته‌های Xray، IKEv2 و L2TP، نقاط اتصال عمومی، یافتن تارگت REALITY، گروه‌های دسترسی |
| [کاربران و اشتراک‌ها](docs/fa/users-and-subscriptions.md) | سهمیه، انقضا، حساب‌های در انتظار، لینک اشتراک، کد دسترسی، پروفایل کلاینت‌ها |
| [نمایندگان](docs/fa/resellers.md) | حساب نماینده، پروتکل‌های مجاز، سقف کاربر و سهمیه‌ی حجم |
| [تانل‌ها](docs/fa/tunnels.md) | اتصال سرور خارج از طریق سرور ایران، ترنسپورت‌ها، پورت‌های فوروارد، تست اتصال و IP Spoofing |
| [ربات تلگرام](docs/fa/telegram-bot.md) | Tifusi Bot: فروش، تمدید و کیف پول خودکار از طریق API پنل |
| [اپ اندروید](docs/fa/android-app.md) | Tifusi VPN: وارد کردن سرورها با کد دسترسی، IKEv2 با یک لمس، گزارش اتصال |
| [مدیریت و عملیات](docs/fa/operations.md) | فرمان‌های `tifusi panel`، مدیران، کلید API، اعلان‌ها، تنظیمات |
| [مرجع استقرار](docs/fa/deployment.md) | Docker Compose، پورت‌ها، TLS، مهاجرت پایگاه داده |
| [معماری](docs/fa/architecture.md) | اجزا، مسیر داده، همگام‌سازی نود، ساختار مخزن |
| [توسعه](docs/fa/development.md) | اجرای بک‌اند، داشبورد و عامل نود از روی سورس |

فهرست تغییرات در [CHANGELOG.md](CHANGELOG.md) و برنامه‌های آینده در [ROADMAP.md](ROADMAP.md) ثبت شده است.

## مجوز استفاده

کد تیفوسی پنل **عمومی است ولی متن‌باز نیست.** می‌توانید کد را ببینید، پنل را بدون تغییر نصب کنید و برای سرورها و سرویس‌های خودتان استفاده کنید. کپی کردن هر بخشی از کد، تغییر و انتشار دوباره، تغییر نام و برند یا فروش آن بدون اجازه‌ی کتبی ممنوع است. جزئیات در فایل [LICENSE](LICENSE).

<sub>نشان این پروژه از پروژه‌ی Tifusi-Tunnel منتقل شده است.</sub>

</div>
