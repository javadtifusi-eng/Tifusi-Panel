"""Backup subscription domains.

One domain is live (the subscription URL customers were given); the others
point at this same server and answer exactly the same way, but are never
shown anywhere — so there is nothing for a filter to find. The Tifusi app
learns them from app.json and, when the live one stops answering from inside
Iran, tries them in order on its own.

Three pieces live here:

- Certificates: each backup gets its own Let's Encrypt certificate under
  certs/sni/<domain>/ and its own server block in certs/sni/servers.conf,
  which the dashboard includes. One shared certificate with
  every name in it would hand the whole list to anyone who opens the live
  domain, which is the one thing this must never do.
- Links: a subscription fetched through a backup comes back with the backup's
  name in the connection links too, since the live name is presumably the one
  that stopped resolving.
- Health: the live domain is checked from Iranian vantage points
  (check-host.net), and the panel can promote the first backup — by hand, or
  on its own after repeated failures.
"""

from __future__ import annotations

import asyncio
import logging
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.host import Host, HostProtocol
from app.settings_store import get_settings_row, get_subscription_url

log = logging.getLogger(__name__)

DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
ACME_DIR = Path("/app/data/letsencrypt")
SNI_DIR = Path("/app/certs/sni")
# The same directory as the dashboard sees it (mounted read-only there).
NGINX_SNI_DIR = "/etc/nginx/certs/sni"

# IKEv2/L2TP profiles carry the server name inside the installed profile, and
# changing it means every customer reinstalls — so their hosts are never moved.
_MOVABLE = {
    HostProtocol.vless,
    HostProtocol.vmess,
    HostProtocol.trojan,
    HostProtocol.shadowsocks,
    HostProtocol.hysteria2,
    HostProtocol.wireguard,
}

# In-memory health of the live domain, refreshed by check_live_domain().
_health: dict = {"domain": None, "ok": None, "reachable": 0, "total": 0, "checked_at": None, "fails": 0}


def normalize(value: str) -> str:
    value = value.strip().lower()
    if "://" in value:
        value = urlsplit(value).hostname or ""
    return value.strip("/").rstrip(".")


def host_of(url: str | None) -> str | None:
    return urlsplit(url).hostname if url else None


async def backups(db: AsyncSession) -> list[str]:
    row = await get_settings_row(db)
    return list(row.backup_domains or [])


async def live_domain(db: AsyncSession) -> str | None:
    return host_of(await get_subscription_url(db))


def health() -> dict:
    return dict(_health)


def has_cert(domain: str) -> bool:
    d = SNI_DIR / domain
    return (d / "fullchain.pem").exists() and (d / "privkey.pem").exists()


# --- certificates -----------------------------------------------------------

def write_nginx_map(domains: list[str]) -> None:
    """certs/sni/servers.conf: one nginx server block per domain that has a
    certificate, included by the dashboard (frontend/nginx-ssl.conf), which
    reloads when this file changes (frontend/docker-entrypoint-tls.sh).
    Static certificate paths, so nginx's master process (root) reads the keys;
    per-request variable paths would make the unprivileged workers read them."""
    SNI_DIR.mkdir(parents=True, exist_ok=True)
    blocks = []
    for d in domains:
        if not has_cert(d):
            continue
        blocks.append(
            "server {\n"
            "    listen 443 ssl;\n"
            f"    server_name {d};\n"
            f"    ssl_certificate     {NGINX_SNI_DIR}/{d}/fullchain.pem;\n"
            f"    ssl_certificate_key {NGINX_SNI_DIR}/{d}/privkey.pem;\n"
            "    include /etc/nginx/tifusi-backup-locations.conf;\n"
            "}\n"
        )
    tmp = SNI_DIR / "servers.conf.tmp"
    tmp.write_text("".join(blocks))
    tmp.replace(SNI_DIR / "servers.conf")


def issue_cert(domain: str) -> str | None:
    """Let's Encrypt over HTTP-01 on port 80, the same way Settings > SSL does.
    Returns None on success, otherwise certbot's own explanation."""
    ACME_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "certbot", "certonly", "--standalone", "--non-interactive", "--agree-tos",
        "--key-type", "rsa", "--rsa-key-size", "2048",
        "--config-dir", str(ACME_DIR / "config"),
        "--work-dir", str(ACME_DIR / "work"),
        "--logs-dir", str(ACME_DIR / "logs"),
        "--register-unsafely-without-email", "-d", domain,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=150)
    except subprocess.TimeoutExpired:
        return "Let's Encrypt did not answer in time"
    if result.returncode != 0:
        return "\n".join(line for line in result.stdout.splitlines() if line.strip())[-600:] or "certbot failed"
    live = ACME_DIR / "config" / "live" / domain
    out = SNI_DIR / domain
    out.mkdir(parents=True, exist_ok=True)
    for name in ("fullchain.pem", "privkey.pem"):
        tmp = out / f"{name}.tmp"
        tmp.write_bytes((live / name).read_bytes())
        tmp.replace(out / name)
    return None


def refresh_renewed_certs(domains: list[str]) -> None:
    """Copies certbot's renewed files over ours; the shared renewal job
    (app/tls_renewal.py) runs `certbot renew` for every lineage already."""
    changed = False
    for d in domains:
        live = ACME_DIR / "config" / "live" / d
        out = SNI_DIR / d
        if not (live / "fullchain.pem").exists() or not out.exists():
            continue
        for name in ("fullchain.pem", "privkey.pem"):
            new = (live / name).read_bytes()
            if not (out / name).exists() or (out / name).read_bytes() != new:
                (out / name).write_bytes(new)
                changed = True
    if changed:
        write_nginx_map(domains)


# --- links ------------------------------------------------------------------

async def link_host_override(request_host: str | None, db: AsyncSession) -> tuple[str, str] | None:
    """(live, backup) when this request came in through a backup domain, so the
    connection links can be rewritten to the name that still resolves."""
    if not request_host:
        return None
    request_host = request_host.lower()
    if request_host not in await backups(db):
        return None
    live = await live_domain(db)
    if not live or live == request_host:
        return None
    return live, request_host


def rewrite_links(links: list[str], override: tuple[str, str] | None) -> list[str]:
    if not override:
        return links
    live, backup = override
    return [link.replace(f"@{live}:", f"@{backup}:") for link in links]


# --- health -----------------------------------------------------------------

async def probe_from_iran(domain: str) -> tuple[int, int]:
    """(reachable, total) Iranian check-host.net nodes that got an HTTP answer."""
    async with httpx.AsyncClient(timeout=20, headers={"Accept": "application/json"}) as client:
        nodes = (await client.get("https://check-host.net/nodes/hosts")).json()["nodes"]
        iran = [name for name, info in nodes.items() if info.get("location", [""])[0] == "ir"]
        if not iran:
            return 0, 0
        params = [("host", f"https://{domain}/")] + [("node", n) for n in iran]
        request_id = (await client.get("https://check-host.net/check-http", params=params)).json()["request_id"]
        await asyncio.sleep(15)
        result = (await client.get(f"https://check-host.net/check-result/{request_id}")).json()
    reachable = 0
    for node in iran:
        rows = result.get(node) or []
        # [[1, 0.21, "OK", "200", "1.2.3.4"]] on success; a timeout or DNS
        # failure comes back as [[0, ...]] or [null].
        if rows and rows[0] and rows[0][0] == 1:
            reachable += 1
    return reachable, len(iran)


async def check_live_domain() -> None:
    """Periodic job. Records whether the live domain answers from Iran, and
    promotes the first healthy backup after three failed checks in a row when
    automatic failover is on."""
    async with async_session() as db:
        live = await live_domain(db)
        if not live:
            return
        try:
            reachable, total = await probe_from_iran(live)
        except Exception as exc:  # the checker itself being down says nothing about us
            log.warning("backup domains: health check failed: %s", exc)
            return
        # Most nodes failing, not all: a single dead probe node is common.
        ok = total == 0 or reachable * 2 > total
        fails = 0 if ok or _health["domain"] != live else _health["fails"] + 1
        _health.update(domain=live, ok=ok, reachable=reachable, total=total, fails=fails,
                       checked_at=asyncio.get_running_loop().time())
        row = await get_settings_row(db)
        if not ok and fails >= 3 and row.backup_auto_failover:
            log.warning("backup domains: %s unreachable from Iran %d times, failing over", live, fails)
            await promote_next(db)


async def promote_next(db: AsyncSession) -> tuple[str, str] | None:
    """Makes the first backup with a certificate the live domain. The old one
    goes to the end of the backup list (it may come back), non-IPsec hosts
    move to the new name, and the live subscription URL follows. Returns
    (old, new), or None when there is no usable backup."""
    row = await get_settings_row(db)
    old = host_of(row.subscription_url or row.public_url)
    candidates = [d for d in (row.backup_domains or []) if has_cert(d) and d != old]
    if not old or not candidates:
        return None
    new = candidates[0]
    remaining = [d for d in (row.backup_domains or []) if d != new]
    row.backup_domains = remaining + ([old] if old not in remaining else [])
    row.subscription_url = f"https://{new}"
    hosts = (await db.execute(select(Host).where(Host.address == old))).scalars().all()
    for host in hosts:
        if host.protocol in _MOVABLE:
            host.address = new
    db.add(row)
    await db.commit()
    _health.update(domain=new, ok=None, reachable=0, total=0, fails=0)
    write_nginx_map(row.backup_domains + [new])
    return old, new
