"""Generates a self-signed CA + leaf server certificate for an IKEv2 Core's
`ikev2_certificate`/`ikev2_certificate_key` fields.

Purely a convenience for the admin — node_agent/ipsec.py already self-signs
an equivalent cert on the node itself whenever these two fields are left
blank. This buys the admin a cert they can see and hand to clients that
need the issuing CA installed to trust it.
"""
import ipaddress
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def generate_self_signed_ikev2_cert(host: str) -> tuple[str, str]:
    """Returns (certificate_pem, key_pem) — the leaf cert (with the CA
    appended, so a single paste carries the whole trust chain) and its key.
    """
    host = (host or "").strip() or "ikev2-server"
    now = datetime.now(timezone.utc)

    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Tifusi IKEv2 CA")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(hours=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    san: list[x509.GeneralName] = [x509.DNSName(host)]
    try:
        san.append(x509.IPAddress(ipaddress.ip_address(host)))
    except ValueError:
        pass
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]))
        .issuer_name(ca_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(hours=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=True,
                data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    cert_pem = (
        leaf_cert.public_bytes(serialization.Encoding.PEM).decode()
        + ca_cert.public_bytes(serialization.Encoding.PEM).decode()
    )
    key_pem = leaf_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()
    ).decode()
    return cert_pem, key_pem
