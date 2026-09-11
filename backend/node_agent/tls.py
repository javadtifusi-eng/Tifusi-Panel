"""Generates the self-signed certificate the node agent serves itself over
HTTPS on. Closes the plain-HTTP gap in panel <-> node traffic (the node's
API key and every pushed user's password/PSK/IKEv2 key used to cross the
network in cleartext — see app/nodes/sync.py) without needing a real CA or
any manual cert distribution to each node.

This is encryption, not authentication: the panel connects with certificate
verification off (there's no shared CA to check this self-signed cert
against), so it stops a passive eavesdropper from reading the wire but
doesn't by itself stop an *active* on-path attacker who can intercept and
re-terminate the connection. The API key remains the actual credential —
full mTLS (the node also verifying who it's talking to) is still real
future work, just a smaller gap than plaintext HTTP was.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def ensure_self_signed_cert(cert_path: Path, key_path: Path) -> None:
    """No-ops if both files already exist — the cert is only regenerated
    when it (or the container filesystem it lives on) doesn't exist yet,
    so a plain restart keeps the same cert instead of rotating it."""
    if cert_path.exists() and key_path.exists():
        return

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "tifusi-node-agent")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(hours=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("tifusi-node-agent")]), critical=False
        )
        .sign(key, hashes.SHA256())
    )

    key_bytes = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )
    key_path.write_bytes(key_bytes)
    key_path.chmod(0o600)
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
