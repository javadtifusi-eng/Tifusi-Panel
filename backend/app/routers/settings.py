import asyncio
import re
import subprocess
from pathlib import Path

from cryptography import x509
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as env_settings
from app.database import engine, get_db
from app.dependencies import require_permission
from app.notifications.discord import send_discord_message
from app.notifications.telegram import send_telegram_message
from app.notifications.webhook import send_webhook_event
from app.nodes.sync import resync_nodes_in_background
from app.schemas.settings import (
    BackupDomainAdd,
    BackupDomainsResponse,
    BackupDomainState,
    PanelSettingsResponse,
    PanelSettingsUpdate,
)
from app.subscription import backup_domains as bd
from app.settings_store import get_settings_row

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_permission("settings"))])

_SQLITE_PREFIX = "sqlite+aiosqlite:///"
_SQLITE_MAGIC = b"SQLite format 3\x00"

# Shared with the dashboard container (mounted read-only there at
# /etc/nginx/certs — same host directory, different in-container path).
# Dropping files here is how the dashboard's nginx picks up HTTPS; see
# frontend/docker-entrypoint-tls.sh for the side that watches for them.
_CERTS_DIR = Path("/app/certs")
_CERT_FILE = _CERTS_DIR / "fullchain.pem"
_KEY_FILE = _CERTS_DIR / "privkey.pem"


def _sqlite_path() -> Path | None:
    url = env_settings.database_url
    if not url.startswith(_SQLITE_PREFIX):
        return None
    return Path(url[len(_SQLITE_PREFIX) :])


@router.get("", response_model=PanelSettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)) -> PanelSettingsResponse:
    return await get_settings_row(db)


@router.put("", response_model=PanelSettingsResponse)
async def update_settings(payload: PanelSettingsUpdate, db: AsyncSession = Depends(get_db)) -> PanelSettingsResponse:
    row = await get_settings_row(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/telegram/test", status_code=204)
async def test_telegram(db: AsyncSession = Depends(get_db)) -> None:
    row = await get_settings_row(db)
    if not row.telegram_bot_token or not row.telegram_chat_id:
        raise HTTPException(status_code=400, detail="Set both the bot token and chat ID first")

    ok = await send_telegram_message(db, "✅ این یه پیام تستی از پنل Tifusi هست.")
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to reach Telegram — check the token and chat ID")


@router.post("/webhook/test", status_code=204)
async def test_webhook(db: AsyncSession = Depends(get_db)) -> None:
    row = await get_settings_row(db)
    if not row.webhook_url:
        raise HTTPException(status_code=400, detail="Set a webhook URL first")

    ok = await send_webhook_event(db, "test", {"message": "This is a test webhook from Tifusi Panel."})
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to reach the webhook URL")


@router.post("/discord/test", status_code=204)
async def test_discord(db: AsyncSession = Depends(get_db)) -> None:
    row = await get_settings_row(db)
    if not row.discord_webhook_url:
        raise HTTPException(status_code=400, detail="Set a Discord webhook URL first")

    ok = await send_discord_message(db, "✅ This is a test message from Tifusi Panel.")
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to reach the Discord webhook URL")


@router.get("/backup")
async def download_backup() -> FileResponse:
    path = _sqlite_path()
    if path is None or not path.exists():
        raise HTTPException(
            status_code=400,
            detail="The professional edition (MySQL) is backed up on the server with: tifusi panel backup",
        )
    return FileResponse(path, filename="tifusi-panel-backup.db", media_type="application/octet-stream")


@router.post("/restore", status_code=204)
async def restore_backup(file: UploadFile = File(...)) -> None:
    path = _sqlite_path()
    if path is None:
        raise HTTPException(
            status_code=400,
            detail="The professional edition (MySQL) is restored on the server with: tifusi panel restore",
        )

    header = await file.read(len(_SQLITE_MAGIC))
    if header != _SQLITE_MAGIC:
        raise HTTPException(status_code=400, detail="That doesn't look like a SQLite database file")
    rest = await file.read()

    # Every pooled connection has to close before the file underneath them
    # changes, or an in-flight connection would keep reading/writing the old
    # file while brand-new connections opened after this point pick up the
    # replacement — two different databases answering at once.
    await engine.dispose()

    tmp_path = path.with_suffix(".restore-tmp")
    tmp_path.write_bytes(header + rest)
    tmp_path.replace(path)


def _install_cert(cert_bytes: bytes, key_bytes: bytes) -> None:
    _CERTS_DIR.mkdir(parents=True, exist_ok=True)
    # Write to temp files first and rename into place, so the dashboard's
    # reload watcher (polling on a timer, not locked in step with this
    # request) never sees a half-written cert or key.
    cert_tmp = _CERT_FILE.with_suffix(".tmp")
    key_tmp = _KEY_FILE.with_suffix(".tmp")
    cert_tmp.write_bytes(cert_bytes)
    key_tmp.write_bytes(key_bytes)
    cert_tmp.replace(_CERT_FILE)
    key_tmp.replace(_KEY_FILE)


def _cert_info(cert_bytes: bytes) -> dict:
    cert = x509.load_pem_x509_certificate(cert_bytes)
    cn = cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
    issuer_cn = cert.issuer.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
    return {
        "domain": cn[0].value if cn else None,
        "issuer": issuer_cn[0].value if issuer_cn else None,
        "expires_at": cert.not_valid_after_utc.isoformat(),
        "self_signed": cert.issuer == cert.subject,
    }


@router.get("/tls")
async def get_tls_status() -> dict:
    enabled = _CERT_FILE.exists() and _KEY_FILE.exists()
    info: dict = {"enabled": enabled}
    if enabled:
        try:
            info.update(_cert_info(_CERT_FILE.read_bytes()))
        except ValueError:
            # A cert this panel itself never wrote (hand-placed by an
            # admin) that happens to be unparsable — the /tls status
            # itself is still meaningful, just without the extra detail.
            pass
    return info


@router.post("/tls", status_code=204)
async def upload_tls(
    cert: UploadFile = File(...),
    key: UploadFile = File(...),
) -> None:
    cert_bytes = await cert.read()
    key_bytes = await key.read()
    if not cert_bytes or not key_bytes:
        raise HTTPException(status_code=400, detail="Both the certificate and the private key are required")
    if b"BEGIN CERTIFICATE" not in cert_bytes:
        raise HTTPException(status_code=400, detail="That doesn't look like a PEM certificate file")
    if b"PRIVATE KEY" not in key_bytes:
        raise HTTPException(status_code=400, detail="That doesn't look like a PEM private key file")

    _install_cert(cert_bytes, key_bytes)


@router.delete("/tls", status_code=204)
async def remove_tls() -> None:
    _CERT_FILE.unlink(missing_ok=True)
    _KEY_FILE.unlink(missing_ok=True)


_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$")

# Persisted (survives a container recreate) so a renewal later doesn't
# start from a blank Let's Encrypt account/order history — same directory
# shape certbot always uses, just relocated under the data volume every
# other piece of panel state already lives in.
_ACME_DIR = Path("/app/data/letsencrypt")


class SslRequest(BaseModel):
    domain: str = Field(min_length=1, max_length=253)


@router.post("/ssl/request", response_model=PanelSettingsResponse)
async def request_ssl(payload: SslRequest, db: AsyncSession = Depends(get_db)) -> PanelSettingsResponse:
    """One click in place of the certbot dance this panel's own install.sh
    (and, this one night, a great deal of manual troubleshooting) otherwise
    walks an admin through by hand: runs certbot's standalone HTTP-01
    authenticator right inside this container, which is why panel publishes
    host port 80 (see docker-compose.yml) — Let's Encrypt connects to that
    port directly, so it has to actually be free and internet-reachable,
    exactly like install.sh's own SSL step already required.
    """
    domain = payload.domain.strip().lower()
    if not _DOMAIN_RE.match(domain):
        raise HTTPException(status_code=400, detail="That doesn't look like a real domain name")

    _ACME_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "certbot", "certonly", "--standalone", "--non-interactive", "--agree-tos",
        # RSA, not certbot's own ECDSA default: this cert can end up reused
        # as a Core's IKEv2 certificate (see cores.py's use-panel-cert
        # endpoint), and the node's strongSwan build has no EC plugin —
        # confirmed live, an ECDSA cert there fails with "parsing X509
        # certificate failed" and loads zero IKEv2 connections. RSA works
        # for the dashboard's own HTTPS exactly the same as ECDSA would.
        "--key-type", "rsa", "--rsa-key-size", "2048",
        "--config-dir", str(_ACME_DIR / "config"),
        "--work-dir", str(_ACME_DIR / "work"),
        "--logs-dir", str(_ACME_DIR / "logs"),
        "-m", f"admin@{domain}", "-d", domain,
    ]

    def _run() -> subprocess.CompletedProcess:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    try:
        result = await asyncio.to_thread(_run)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Let's Encrypt didn't respond in time — try again shortly")

    if result.returncode != 0:
        # certbot's own last lines are almost always the actually useful
        # part (the generic wrapper text above it never explains *why*) —
        # surfacing those instead of a bare exit code is the whole point
        # of running this from the panel instead of leaving an admin to
        # go find and read /var/log/letsencrypt/letsencrypt.log themselves.
        tail = "\n".join(line for line in result.stdout.splitlines() if line.strip())[-800:]
        raise HTTPException(status_code=502, detail=tail or "certbot failed — no output captured")

    live_dir = _ACME_DIR / "config" / "live" / domain
    fullchain = live_dir / "fullchain.pem"
    privkey = live_dir / "privkey.pem"
    if not fullchain.exists() or not privkey.exists():
        raise HTTPException(status_code=502, detail="certbot reported success but the certificate files are missing")

    _install_cert(fullchain.read_bytes(), privkey.read_bytes())

    row = await get_settings_row(db)
    if not row.public_url:
        row.public_url = f"https://{domain}"
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


# --- backup subscription domains (app/subscription/backup_domains.py) ---


async def _backup_state(db: AsyncSession) -> BackupDomainsResponse:
    row = await get_settings_row(db)
    health = bd.health()
    live = await bd.live_domain(db)
    same = health.get("domain") == live
    return BackupDomainsResponse(
        live=live,
        live_ok=health.get("ok") if same else None,
        live_reachable=health.get("reachable", 0) if same else 0,
        live_total=health.get("total", 0) if same else 0,
        backups=[BackupDomainState(domain=d, has_cert=bd.has_cert(d)) for d in (row.backup_domains or [])],
        auto_failover=bool(row.backup_auto_failover),
    )


@router.get("/backup-domains", response_model=BackupDomainsResponse)
async def get_backup_domains(db: AsyncSession = Depends(get_db)) -> BackupDomainsResponse:
    return await _backup_state(db)


@router.post("/backup-domains", response_model=BackupDomainsResponse)
async def add_backup_domain(payload: BackupDomainAdd, db: AsyncSession = Depends(get_db)) -> BackupDomainsResponse:
    """Adds a backup and gets its own certificate. The domain must already
    point at this server (an A record, not proxied), exactly like Settings > SSL."""
    domain = bd.normalize(payload.domain)
    if not bd.DOMAIN_RE.match(domain):
        raise HTTPException(status_code=400, detail="That doesn't look like a real domain name")
    row = await get_settings_row(db)
    current = list(row.backup_domains or [])
    if domain == await bd.live_domain(db) or domain in current:
        raise HTTPException(status_code=409, detail="This domain is already in use")
    error = await asyncio.to_thread(bd.issue_cert, domain)
    if error:
        raise HTTPException(status_code=502, detail=error)
    row.backup_domains = current + [domain]
    db.add(row)
    await db.commit()
    bd.write_nginx_map(row.backup_domains)
    return await _backup_state(db)


@router.delete("/backup-domains/{domain}", response_model=BackupDomainsResponse)
async def remove_backup_domain(domain: str, db: AsyncSession = Depends(get_db)) -> BackupDomainsResponse:
    row = await get_settings_row(db)
    row.backup_domains = [d for d in (row.backup_domains or []) if d != domain.lower()]
    db.add(row)
    await db.commit()
    bd.write_nginx_map(row.backup_domains)
    return await _backup_state(db)


@router.post("/backup-domains/check", response_model=BackupDomainsResponse)
async def check_backup_domains(db: AsyncSession = Depends(get_db)) -> BackupDomainsResponse:
    await bd.check_live_domain()
    return await _backup_state(db)


@router.post("/backup-domains/failover", response_model=BackupDomainsResponse)
async def failover_backup_domain(background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)) -> BackupDomainsResponse:
    moved = await bd.promote_next(db)
    if moved is None:
        raise HTTPException(status_code=400, detail="No backup domain with a certificate to move to")
    background_tasks.add_task(resync_nodes_in_background)
    return await _backup_state(db)
