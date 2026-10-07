<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="160" alt="Tifusi Panel" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<p align="center"><b>سامانه‌ی خودمیزبان مدیریت زیرساخت پروکسی و VPN</b></p>

<p align="center">
  <a href="https://github.com/javadtifusi-eng/Tifusi-Panel/stargazers"><img src="https://img.shields.io/github/stars/javadtifusi-eng/Tifusi-Panel?style=flat-square&label=stars&color=F97316" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/github/v/tag/javadtifusi-eng/Tifusi-Panel?filter=v*&sort=semver&label=version&style=flat-square&color=22C55E" alt="version" />
  <a href="https://t.me/javadheydeari"><img src="https://img.shields.io/badge/Support-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram support" /></a>
  <img src="https://img.shields.io/github/last-commit/javadtifusi-eng/Tifusi-Panel?label=last%20update&style=flat-square&color=0EA5E9" alt="last update" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-source--available-DC2626?style=flat-square" alt="license" /></a>
</p>

<p align="center">
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/fa/"><img src="https://img.shields.io/badge/Documentation-F97316?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" height="38" /></a>
  <br />
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/fa/"><b>📖 مستندات کامل در سایت</b></a>
</p>

<p align="center"><img src="docs/brand/gb.png" height="14" alt="" /> <a href="README.md">English</a> &nbsp;·&nbsp; <img src="docs/brand/ir.png" height="14" alt="" /> <b>فارسی</b> &nbsp;·&nbsp; <img src="docs/brand/ru.png" height="14" alt="" /> <a href="README.ru.md">Русский</a></p>

<p align="center">
  <img src="docs/screenshots/live-dashboard-hosts.svg" width="100%" alt="داشبورد و هاست‌های تیفوسی پنل، زنده" />
  <br /><br />
  <img src="docs/screenshots/live-tunnels-fa.webp" width="100%" alt="بخش تانل‌ها، زنده" />
</p>

## ویژگی‌های برجسته

<div dir="rtl">

| | |
| --- | --- |
| 🌐 **همه‌ی پروتکل‌ها روی یک نود** | Xray (VLESS، VMess، Trojan، Shadowsocks، REALITY)، IKEv2، L2TP، PPTP، Hysteria2 و WireGuard کنار هم؛ پنل کانفیگ هر نود را می‌سازد و می‌فرستد |
| 🚇 **تانل برای شبکه‌های سخت** | رله‌ی ایران ↔ خارج با TCP/TLS/WebSocket/mux، ترنسپورت Stealth، UDP (KCP)، حامل‌های IP Spoof و عبور از CDN، با تست لینک و نمایش زنده‌ی ترافیک |
| 🔑 **نصب از داخل پنل** | نصب نودها و هر دو سمت تانل با SSH و کلید خود پنل — آنلاین، یا از بسته‌ی آفلاین با SFTP برای سرورهای بدون اینترنت خارج |
| 🛡️ **آپدیت با برگشت خودکار** | اعتبارسنجی هر کانفیگ (`xray -test`) و نگه‌داشتن آخرین نسخه‌ی سالم؛ آپدیت باینری تانل و ایجنت نود با برگشت خودکار، نودها یکی‌یکی با Canary |
| 🔒 **محافظ‌ها** | پورت‌های رزرو (ایجنت، SSH، APIهای داخلی) را هیچ inboundی نمی‌گیرد؛ کانفیگ ردشده روی نود نشان داده می‌شود و نود سرویس‌دهی را ادامه می‌دهد |
| 👤 **کاربران و اشتراک** | یک لینک برای همه‌ی کلاینت‌ها (ساده، Clash، sing-box، صفحه‌ی HTML)، متغیرهای پویای ریمارک، گروه برای inbound یا هاست، on_hold، محدودیت دستگاه، ریست دوره‌ای، نماینده با سهمیه |
| 📶 **در دسترس ماندن** | سپر اتصال (Failover)، سلامت شبکه از داخل ایران، دامنه‌های پشتیبان اشتراک، یابنده‌ی تارگت REALITY |
| 🧪 **تست‌شده** | تست‌های pytest (لینک‌ها، اشتراک، ترافیک، مایگریشن‌ها، مسیرهای برگشت) با هر push اجرا می‌شوند؛ ایمیج‌ها فقط بعد از پاس شدن منتشر می‌شوند |

</div>

<p align="center">
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/fa/"><img src="https://img.shields.io/badge/Documentation-F97316?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" height="38" /></a>
</p>
