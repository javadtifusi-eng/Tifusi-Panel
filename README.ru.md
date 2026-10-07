<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="160" alt="Tifusi Panel" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<p align="center"><b>Самостоятельно размещаемая панель управления прокси и VPN</b></p>

<p align="center">
  <a href="https://github.com/javadtifusi-eng/Tifusi-Panel/stargazers"><img src="https://img.shields.io/github/stars/javadtifusi-eng/Tifusi-Panel?style=flat-square&label=stars&color=F97316" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/github/v/tag/javadtifusi-eng/Tifusi-Panel?filter=v*&sort=semver&label=version&style=flat-square&color=22C55E" alt="version" />
  <a href="https://t.me/javadheydeari"><img src="https://img.shields.io/badge/Support-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram support" /></a>
  <img src="https://img.shields.io/github/last-commit/javadtifusi-eng/Tifusi-Panel?label=last%20update&style=flat-square&color=0EA5E9" alt="last update" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-source--available-DC2626?style=flat-square" alt="license" /></a>
</p>

<p align="center">
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/en/"><img src="https://img.shields.io/badge/Documentation-F97316?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" height="38" /></a>
  <br />
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/en/"><b>📖 Полная документация на сайте</b></a>
</p>

<p align="center"><img src="docs/brand/gb.png" height="14" alt="" /> <a href="README.md">English</a> &nbsp;·&nbsp; <img src="docs/brand/ir.png" height="14" alt="" /> <a href="README.fa.md">فارسی</a> &nbsp;·&nbsp; <img src="docs/brand/ru.png" height="14" alt="" /> <b>Русский</b></p>

<p align="center">
  <img src="docs/screenshots/live-dashboard-hosts.svg" width="100%" alt="Панель и хосты Tifusi Panel в реальном времени" />
  <br /><br />
  <img src="docs/screenshots/live-tunnels-en.webp" width="100%" alt="Туннели в реальном времени" />
</p>

## Возможности

| | |
| --- | --- |
| 🌐 **Все протоколы на одном узле** | Xray (VLESS, VMess, Trojan, Shadowsocks, REALITY), IKEv2, L2TP, PPTP, Hysteria2 и WireGuard одновременно; панель собирает и отправляет конфигурацию каждого узла |
| 🚇 **Туннели для сложных сетей** | Ретрансляция Иран ↔ зарубеж поверх TCP/TLS/WebSocket/mux, скрытый транспорт, UDP (KCP), подмена IP и CDN, с проверкой канала и живой скоростью |
| 🔑 **Установка из панели** | Узлы и обе стороны туннеля ставятся по SSH собственным ключом панели — онлайн или из офлайн-пакета по SFTP для серверов без внешнего интернета |
| 🛡️ **Обновления с автоматическим откатом** | Каждая конфигурация проверяется (`xray -test`), последняя рабочая сохраняется; бинарник туннеля и агент узла обновляются с автооткатом, узлы по одному с canary |
| 🔒 **Защита от ошибок** | Зарезервированные порты (агент, SSH, внутренние API) нельзя занять inbound'ом; отклонённая конфигурация показывается на узле, а он продолжает работать |
| 👤 **Пользователи и подписки** | Одна ссылка для всех клиентов (plain, Clash, sing-box, HTML), динамические переменные в имени, группы для inbound или хоста, on-hold, лимит устройств, периодический сброс, реселлеры с квотами |
| 📶 **Доступность** | Connection Shield, мониторинг сети изнутри Ирана, резервные домены подписки, сканер целей REALITY |
| 🧪 **Протестировано** | Набор тестов pytest (ссылки, подписки, трафик, миграции, пути отката) запускается при каждом push; образы публикуются только после успешного прогона |

<p align="center">
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/en/"><img src="https://img.shields.io/badge/Documentation-F97316?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" height="38" /></a>
</p>
