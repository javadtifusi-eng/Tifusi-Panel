"""Keeps a Let's Encrypt certificate from Settings > SSL Certificate > "Get
free SSL" from running out: a panel that got one never had anything renew
it, and it simply expired after 90 days.

Twice a day this runs `certbot renew` against the same config directory the
"Get free SSL" button wrote (certbot itself only acts within 30 days of
expiry, so almost every run is a no-op). When a renewed certificate is the
one the panel is serving, it is installed in its place, and every IKEv2 Core
that was using that same certificate gets the new one too, followed by a
node resync, so IKEv2 and Hysteria2 on the nodes pick it up as well.

A certificate the admin uploaded by hand is never touched: only certificates
certbot manages here can be renewed, and only the one whose names match the
installed certificate is ever installed.
"""

import asyncio
import subprocess
from pathlib import Path

from cryptography import x509
from sqlalchemy import select

from app.database import async_session
from app.models.core import Core, CoreType
from app.nodes.sync import resync_connected_nodes
from app.notifications.telegram import send_telegram_message
from app.routers.settings import _ACME_DIR, _CERT_FILE, _install_cert

_CONFIG_DIR = _ACME_DIR / "config"


def _leaf(pem: str | None) -> x509.Certificate | None:
    """The first certificate in a PEM bundle (the server's own), or None."""
    if not pem or "BEGIN CERTIFICATE" not in pem:
        return None
    try:
        return x509.load_pem_x509_certificate(pem.encode())
    except ValueError:
        return None


def _names(cert: x509.Certificate) -> set[str]:
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        return {n.lower() for n in san.get_values_for_type(x509.DNSName)}
    except x509.ExtensionNotFound:
        cn = cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
        return {str(cn[0].value).lower()} if cn else set()


def _run_certbot_renew() -> subprocess.CompletedProcess:
    # Each lineage's renewal/*.conf remembers how it was issued (standalone
    # on port 80, RSA 2048), so renew needs nothing else from us.
    return subprocess.run(
        [
            "certbot", "renew", "--non-interactive",
            "--config-dir", str(_CONFIG_DIR),
            "--work-dir", str(_ACME_DIR / "work"),
            "--logs-dir", str(_ACME_DIR / "logs"),
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )


def _matching_lineage(installed: x509.Certificate) -> Path | None:
    """The certbot lineage whose names are exactly the installed cert's."""
    live = _CONFIG_DIR / "live"
    if not live.is_dir():
        return None
    want = _names(installed)
    for lineage in live.iterdir():
        fullchain = lineage / "fullchain.pem"
        cert = _leaf(fullchain.read_text()) if fullchain.is_file() else None
        if cert is not None and _names(cert) == want:
            return lineage
    return None


async def renew_certificates() -> None:
    if not any((_CONFIG_DIR / "renewal").glob("*.conf")):
        return  # This panel never got a certificate from Let's Encrypt.

    result = await asyncio.to_thread(_run_certbot_renew)
    if result.returncode != 0:
        tail = "\n".join(line for line in (result.stdout + result.stderr).splitlines() if line.strip())[-600:]
        async with async_session() as db:
            await send_telegram_message(db, f"⚠️ تمدید خودکار گواهی SSL ناموفق بود:\n{tail}")
        return

    old_pem = _CERT_FILE.read_text() if _CERT_FILE.exists() else None
    old = _leaf(old_pem)
    if old is None:
        return
    lineage = _matching_lineage(old)
    if lineage is None:
        return  # The panel serves a certificate certbot doesn't manage.

    new_chain = (lineage / "fullchain.pem").read_bytes()
    new_key = (lineage / "privkey.pem").read_bytes()
    new = _leaf(new_chain.decode())
    if new is None or new.serial_number == old.serial_number:
        return  # Not renewed this time.

    _install_cert(new_chain, new_key)

    async with async_session() as db:
        cores = (await db.execute(select(Core).where(Core.core_type == CoreType.ikev2))).scalars().all()
        for core in cores:
            used = _leaf(core.ikev2_certificate)
            if used is not None and used.serial_number == old.serial_number:
                core.ikev2_certificate = new_chain.decode()
                core.ikev2_certificate_key = new_key.decode()
        await db.commit()
        # Pushes the new IKEv2 certificate and restarts Hysteria2, which reads
        # the panel's certificate files only when it starts.
        await resync_connected_nodes(db)
        await send_telegram_message(
            db, f"🔒 گواهی SSL تمدید شد؛ اعتبار تا {new.not_valid_after_utc:%Y-%m-%d}."
        )
