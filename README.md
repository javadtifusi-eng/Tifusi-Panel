<p align="center">
  <img src="frontend/public/logo-tifusi.png" width="160" alt="Tifusi Panel" />
</p>

<h1 align="center">TIFUSI PANEL</h1>

<p align="center"><b>Self-hosted control plane for proxy and VPN infrastructure</b></p>

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
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/en/"><b>📖 Full documentation on the website</b></a>
</p>

<p align="center"><img src="docs/brand/gb.png" height="14" alt="" /> <b>English</b> &nbsp;·&nbsp; <img src="docs/brand/ir.png" height="14" alt="" /> <a href="README.fa.md">فارسی</a> &nbsp;·&nbsp; <img src="docs/brand/ru.png" height="14" alt="" /> <a href="README.ru.md">Русский</a></p>

<p align="center">
  <img src="docs/screenshots/live-dashboard-hosts.svg" width="100%" alt="Tifusi Panel dashboard and hosts, live" />
  <br /><br />
  <img src="docs/screenshots/live-tunnels-en.webp" width="100%" alt="Tunnels page, live" />
</p>

## Highlights

| | |
| --- | --- |
| 🌐 **Every protocol on one node** | Xray (VLESS, VMess, Trojan, Shadowsocks, REALITY), IKEv2, L2TP, PPTP, Hysteria2 and WireGuard side by side; the panel renders and pushes each node's config |
| 🚇 **Tunnels for hard networks** | Iran ↔ abroad relays over TCP/TLS/WebSocket/mux, a stealth transport, UDP (KCP), IP-spoofed carriers and CDN fronting, with a link test and live throughput |
| 🔑 **Install from the panel** | Nodes and both tunnel sides installed over SSH with the panel's own key — online, or from an offline bundle over SFTP for servers with no outside internet |
| 🛡️ **Updates that roll themselves back** | Config pushes validated (`xray -test`) with the last good config kept; tunnel binaries and node agents updated with automatic rollback, nodes one at a time with a canary |
| 🔒 **Guard rails** | Reserved ports (agent, SSH, internal APIs) can't be taken by an inbound; a refused config is shown on the node while it keeps serving |
| 👤 **Users & subscriptions** | One link for every client (plain, Clash, sing-box, HTML page), dynamic remark variables, groups per inbound or per host, on-hold, device limits, periodic resets, resellers with quotas |
| 📶 **Staying reachable** | Connection Shield failover, network health from inside Iran, backup subscription domains, REALITY target scanner |
| 🧪 **Tested** | A pytest suite (links, subscriptions, traffic, migrations, rollback paths) runs on every push; images are only published when it passes |

<p align="center">
  <a href="https://javadtifusi-eng.github.io/Tifusi-Panel/en/"><img src="https://img.shields.io/badge/Documentation-F97316?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" height="38" /></a>
</p>
