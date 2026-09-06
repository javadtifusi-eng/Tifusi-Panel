from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as env_settings
from app.database import engine, get_db
from app.dependencies import get_current_admin
from app.notifications.telegram import send_telegram_message
from app.schemas.settings import PanelSettingsResponse, PanelSettingsUpdate
from app.settings_store import get_settings_row

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(get_current_admin)])

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


@router.get("/backup")
async def download_backup() -> FileResponse:
    path = _sqlite_path()
    if path is None or not path.exists():
        raise HTTPException(status_code=400, detail="Backup is only supported for the built-in SQLite database")
    return FileResponse(path, filename="tifusi-panel-backup.db", media_type="application/octet-stream")


@router.post("/restore", status_code=204)
async def restore_backup(file: UploadFile = File(...)) -> None:
    path = _sqlite_path()
    if path is None:
        raise HTTPException(status_code=400, detail="Restore is only supported for the built-in SQLite database")

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


@router.get("/tls")
async def get_tls_status() -> dict:
    return {"enabled": _CERT_FILE.exists() and _KEY_FILE.exists()}


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


@router.delete("/tls", status_code=204)
async def remove_tls() -> None:
    _CERT_FILE.unlink(missing_ok=True)
    _KEY_FILE.unlink(missing_ok=True)
