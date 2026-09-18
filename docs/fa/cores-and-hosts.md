<div dir="rtl"><sub>[→ صفحه‌ی اصلی](../../README.fa.md) · 🚀 [نصب](installation.md) · 🖥️ [نودها](nodes.md) · 🧩 **هسته‌ها و هاست‌ها** · 👥 [کاربران](users-and-subscriptions.md) · 🤝 [نمایندگان](resellers.md) · 🌉 [تانل‌ها](tunnels.md) · 🤖 [ربات تلگرام](telegram-bot.md) · 📱 [اپ اندروید](android-app.md) · ⚙️ [مدیریت](operations.md) · 🐳 [مرجع استقرار](deployment.md) · 🏗️ [معماری](architecture.md) · 🛠️ [توسعه](development.md)</sub></div>

<div dir="rtl">

# هسته‌ها، هاست‌ها و گروه‌ها

## مدل پیکربندی

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

## هسته‌ها

هسته فناوری سمت سروری است که روی نود اجرا می‌شود و یکی از سه نوع زیر است:

| نوع | محتوا |
| --- | --- |
| `xray` | یک پیکربندی کامل Xray به‌صورت JSON، دقیقاً همان چیزی که `xray run -c` می‌پذیرد، همراه با ویرایشگرهای ساخت‌یافته برای routing، outbounds و DNS. inboundهای آن استخراج شده و برای هاست‌ها و گروه‌ها قابل انتخاب می‌شوند. |
| `ikev2` | پارامترهای سرور IKEv2/IPsec: حالت احراز هویت (EAP-MSCHAPv2 یا PSK)، شناسه‌ی راه دور (Remote ID) و گواهی سرور. |
| `l2tp` | پارامترهای سرور L2TP/IPsec، از جمله PSK مشترک. |

هر هسته را می‌توان به یک یا چند نود تخصیص داد. هر نود هم‌زمان یک هسته‌ی Xray و یک هسته‌ی IPsec دارد؛ بخش [دو هسته روی یک نود](nodes.md) را ببینید.

## هاست‌ها

هاست نقطه‌ی اتصال عمومی است که کلاینت دریافت می‌کند: نشانی، پورت و نام نمایشی، برای VLESS، VMess، Trojan، Shadowsocks، Hysteria2، L2TP و IKEv2.

- **پروتکل‌های Xray** به یک inbound استخراج‌شده از پیکربندی هسته ارجاع می‌دهند و پارامترهای transport، security و REALITY را از آن به ارث می‌برند. SNI، ALPN، fingerprint، path و security را می‌توان برای کلاینت‌ها بازنویسی کرد.
- هاست‌های **L2TP** به یک هسته‌ی `l2tp` متصل می‌شوند و از PSK مشترک آن استفاده می‌کنند.
- هاست‌های **IKEv2** به یک هسته‌ی `ikev2` متصل می‌شوند. سرور با گواهی X.509 (به‌طور پیش‌فرض خودامضا، یا زنجیره‌ی صادرشده توسط CA) و هر کاربر با EAP-MSCHAPv2 احراز هویت می‌شود.
- هاست‌های **Hysteria2** پارامترهای خود را نگه می‌دارند، زیرا Hysteria2 بیرون از نودها اجرا می‌شود.

### یافتن بهترین تارگت REALITY

گزینه‌ی **پیدا کردن بهترین تارگت (SNI)** در فرم هاست، تأخیر حدود ۱۶۰ دامنه‌ی SNI را اندازه‌گیری کرده و سریع‌ترین گزینه را به‌عنوان تارگت REALITY پیشنهاد می‌کند.

## گروه‌ها

گروه‌ها کنترل دسترسی واقعی‌اند، نه صرفاً دسته‌بندی. هاست یا inbound بدون گروه برای همه‌ی کاربران قابل مشاهده است. پس از اتصال به یک یا چند گروه، فقط برای اعضای همان گروه‌ها در اشتراک و در پیکربندی نود درج می‌شود؛ بنابراین عضویت در گروه هم لینک‌های دریافتی کاربر و هم اعتبارنامه‌های ارسالی به نودها را تعیین می‌کند.

</div>

---

<div dir="rtl"><sub>[→ نودها](nodes.md) · [کاربران ←](users-and-subscriptions.md)</sub></div>
