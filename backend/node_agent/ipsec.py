"""Generates and applies real strongSwan/xl2tpd config for l2tp/ikev2 cores.

Only ever touched when the panel assigns this node an l2tp or ikev2 Core —
a plain Xray node never calls anything here.

strongSwan is built from source in this node's own Dockerfile (Debian's
packaged build ships no eap-mschapv2 — needs MD4, which modern OpenSSL
dropped, so distros just leave it out — and native iOS/Windows IKEv2
"Username" auth hard-requires exactly that method). That build also
doesn't produce the classic `ipsec`/starter tool at all (confirmed live:
`find` for it across the built tree comes up empty, and strongSwan 6
dropped the stroke interface starter depended on anyway) — so charon is
launched directly here, the same way xl2tpd already is, rather than
through `ipsec start`. Everything is driven through `swanctl` (vici)
instead: it loads connections/secrets/pools from swanctl.conf, and its
exit code is how health is judged, since there's no `ipsec status` to ask.

Everything here (the daemons *and* their config) lives inside this node's
own container — only the network namespace is shared with the host (via
--network host in install-node.sh), which is what makes inbound UDP
500/1701/4500 on the host's public IP actually reach charon/xl2tpd here,
and what makes the sysctl/iptables calls below affect the real host
network stack instead of an isolated container-only one.
"""

import ipaddress
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from node_agent import vless_egress

CHARON_BIN = "/usr/libexec/ipsec/charon"
SWANCTL_CONF = Path("/etc/swanctl/swanctl.conf")
SWANCTL_X509 = Path("/etc/swanctl/x509")
SWANCTL_PRIVATE = Path("/etc/swanctl/private")
IKEV2_CERT_BASE = "ikev2-server"
XL2TPD_CONF = Path("/etc/xl2tpd/xl2tpd.conf")
PPP_OPTIONS = Path("/etc/ppp/options.xl2tpd")
CHAP_SECRETS = Path("/etc/ppp/chap-secrets")

# Internal-only pools — never surfaced to an end user (unlike WireGuard's
# subnet, nothing about these needs to be typed into a client), so there's
# nothing for the admin to configure and no reason not to just pick one.
_L2TP_LOCAL_IP = "192.168.42.1"
_L2TP_POOL = "192.168.42.10-192.168.42.250"
_L2TP_SUBNET = "192.168.42.0/24"
_IKEV2_POOL = "10.10.10.10-10.10.10.250"
_IKEV2_SUBNET = "10.10.10.0/24"
_DNS_SERVERS = ("8.8.8.8", "8.8.4.4")


def _write(path: Path, content: str, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    if mode is not None:
        path.chmod(mode)


def _eap_secrets(users: list[dict]) -> str:
    blocks = []
    for i, u in enumerate(users):
        username = str(u.get("username", "")).replace('"', '\\"')
        password = str(u.get("password", "")).replace('"', '\\"')
        if not username or not password:
            continue
        blocks.append(f'  eap-{i} {{\n    id = "{username}"\n    secret = "{password}"\n  }}\n')
    return "".join(blocks)


IKEV2_CA_CERT = SWANCTL_X509 / f"{IKEV2_CERT_BASE}-ca.pem"
IKEV2_LEAF_CERT = SWANCTL_X509 / f"{IKEV2_CERT_BASE}.pem"
IKEV2_LEAF_KEY = SWANCTL_PRIVATE / f"{IKEV2_CERT_BASE}.key"


def _cert_matches_host(host: str) -> bool:
    try:
        cert = x509.load_pem_x509_certificate(IKEV2_LEAF_CERT.read_bytes())
    except (OSError, ValueError):
        return False
    if cert.not_valid_after_utc <= datetime.now(timezone.utc) + timedelta(days=30):
        return False
    try:
        sans = set(cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName))
    except x509.ExtensionNotFound:
        sans = set()
    return host in sans


def _ensure_ikev2_cert(host: str, certificate: str | None = None, certificate_key: str | None = None) -> None:
    """Publishes the server cert for IKEv2's `auth = pubkey` local round.
    With certificate/certificate_key given (the Core's admin-provided
    fields, e.g. a real domain's Let's Encrypt cert), publishes those
    verbatim. Otherwise self-signs a CA + leaf, regenerating only when
    missing/expiring/host-mismatched so an in-flight negotiation never reads
    a half-written file across repeated syncs. A self-signed CA still needs
    clients to trust it explicitly, unlike a real cert.
    """
    if certificate and certificate_key:
        SWANCTL_X509.mkdir(parents=True, exist_ok=True)
        SWANCTL_PRIVATE.mkdir(parents=True, exist_ok=True)
        _write(IKEV2_LEAF_CERT, certificate.strip() + "\n")
        _write(IKEV2_LEAF_KEY, certificate_key.strip() + "\n", mode=0o600)
        return
    host = host or "ikev2-server"
    if _cert_matches_host(host):
        return
    SWANCTL_X509.mkdir(parents=True, exist_ok=True)
    SWANCTL_PRIVATE.mkdir(parents=True, exist_ok=True)
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
        .add_extension(x509.KeyUsage(
            digital_signature=False, content_commitment=False, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
            encipher_only=False, decipher_only=False,
        ), critical=True)
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
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=False, key_encipherment=True,
            data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
            encipher_only=False, decipher_only=False,
        ), critical=True)
        .sign(ca_key, hashes.SHA256())
    )

    _write(IKEV2_CA_CERT, ca_cert.public_bytes(serialization.Encoding.PEM).decode())
    _write(IKEV2_LEAF_CERT, leaf_cert.public_bytes(serialization.Encoding.PEM).decode())
    _write(
        IKEV2_LEAF_KEY,
        leaf_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()
        ).decode(),
        mode=0o600,
    )


def _swanctl_conf(
    core_type: str,
    psk: str,
    remote_id: str | None = None,
    users: list[dict] | None = None,
    ikev2_auth_mode: str = "eap",
) -> str:
    escaped_psk = psk.replace('"', '\\"')
    if core_type == "l2tp":
        return (
            "connections {\n"
            "  l2tp-psk {\n"
            "    version = 1\n"
            "    proposals = aes256-sha256-modp2048,aes128-sha256-modp2048,"
            "aes256-sha1-modp2048,aes128-sha1-modp2048,3des-sha1-modp2048\n"
            "    local_addrs = %any\n"
            "    remote_addrs = %any\n"
            "    local { auth = psk }\n"
            "    remote { auth = psk }\n"
            "    children {\n"
            "      l2tp {\n"
            "        mode = transport\n"
            "        local_ts = dynamic[udp/l2tp]\n"
            "        remote_ts = dynamic[udp]\n"
            "        esp_proposals = aes256-sha1,aes128-sha1,aes256gcm16,3des-sha1\n"
            "      }\n"
            "    }\n"
            "  }\n"
            "}\n"
            "secrets {\n"
            f'  ike-l2tp {{ secret = "{escaped_psk}" }}\n'
            "}\n"
        )
    # ikev2 — local auth is a server certificate (`local.auth = pubkey`),
    # not the Core's PSK: native iOS/Windows IKEv2 clients validate the
    # server's identity via a certificate, and their own VPN setup UI has
    # no PSK field to offer one. Each ProxyUser authenticates to the server
    # over EAP-MSCHAPv2 with their own username/password instead, same
    # per-user login model as l2tp. The Core's psk field is unused here
    # (still used above for l2tp). local.id must be a real domain/IP — it's
    # both the identity a client's "Remote ID" field has to match, and the
    # cert's CN/SAN (see _ensure_ikev2_cert, called by the caller before
    # this function so the cert file already exists when charon loads it).
    host = (remote_id or "").strip()
    local_id_line = f"      id = {host}\n" if host else ""
    is_psk = ikev2_auth_mode == "psk"
    # PSK mode: local AND remote auth are both a single shared secret — no
    # certificate, no per-user EAP login. This exists because some networks'
    # DPI appears to specifically target the IKE Certificate payload rather
    # than IKEv2 traffic in general: in live testing, a plain PSK connection
    # completed instantly on a network where the identical cert+EAP exchange
    # (self-signed AND a publicly-trusted Let's Encrypt cert, tried both)
    # died at exactly the same point every time, right after the server's
    # certificate went out. The tradeoff is real: native iOS/Windows "Shared
    # Secret" IKEv2 has no separate username/password field, so every user
    # of this Host shares one secret with no per-user revocation — cert+EAP
    # stays the default for admins not dealing with this kind of filtering.
    if is_psk:
        local_auth_block = "    local {\n      auth = psk\n" + local_id_line + "    }\n"
        remote_auth_block = "    remote {\n      auth = psk\n    }\n"
        secrets_block = f'  ike-ikev2 {{ secret = "{escaped_psk}" }}\n'
        send_cert_line = ""
    else:
        local_auth_block = (
            "    local {\n      auth = pubkey\n" f"      certs = {IKEV2_LEAF_CERT.name}\n" + local_id_line + "    }\n"
        )
        # eap_id = %any forces a real EAP-Identity request/response round
        # trip instead of defaulting to the client's raw IKE identity
        # (IDi) — an arbitrary self-chosen value, never the real username.
        # Windows/iOS native IKEv2 stacks expect EAP-Identity first and
        # silently drop a bare EAP-Request/MSCHAPv2 without it.
        remote_auth_block = "    remote {\n      auth = eap-mschapv2\n      eap_id = %any\n    }\n"
        secrets_block = _eap_secrets(users or [])
        send_cert_line = "    send_cert = always\n"
    return (
        "connections {\n"
        "  ikev2-eap {\n"
        "    version = 2\n"
        "    unique = never\n"
        f"{send_cert_line}"
        "    fragmentation = yes\n"
        "    dpd_delay = 300s\n"
        # modp1024 fallbacks matter in practice: Windows' native IKEv2
        # client falls back to its own legacy default proposal set
        # (DH group 2 / MODP_1024) on retries regardless of the DHGroup
        # configured via Set-VpnConnectionIPsecConfiguration, and without
        # a matching proposal here charon hard-rejects it with NO_PROP —
        # surfaced client-side as Windows' generic "policy match error".
        # `default` on the end is a last-resort catch-all, matching vpn-ui.
        "    proposals = aes256-sha256-modp2048,aes128-sha256-modp2048,aes256gcm16-prfsha384-ecp384,"
        "aes256-sha256-modp1024,aes128-sha256-modp1024,aes256-sha1-modp1024,default\n"
        "    local_addrs = %any\n"
        "    remote_addrs = %any\n"
        f"{local_auth_block}"
        f"{remote_auth_block}"
        "    children {\n"
        "      net {\n"
        "        local_ts = 0.0.0.0/0,::/0\n"
        "        esp_proposals = aes256gcm16-prfsha384-ecp384,aes256-sha256-modp2048,aes128-sha256-modp2048,"
        "aes256-sha256-modp1024,aes128-sha256-modp1024,aes256-sha256,aes128-sha256,aes256-sha1,aes128-sha1,default\n"
        "      }\n"
        "    }\n"
        f"    pools = ikev2-pool\n"
        "  }\n"
        "}\n"
        "pools {\n"
        "  ikev2-pool {\n"
        f"    addrs = {_IKEV2_POOL}\n"
        f"    dns = {','.join(_DNS_SERVERS)}\n"
        "  }\n"
        "}\n"
        "secrets {\n"
        f"{secrets_block}"
        "}\n"
    )


def _xl2tpd_conf() -> str:
    return (
        "[global]\n"
        "port = 1701\n\n"
        "[lns default]\n"
        f"ip range = {_L2TP_POOL}\n"
        f"local ip = {_L2TP_LOCAL_IP}\n"
        "require chap = yes\n"
        "refuse pap = yes\n"
        "require authentication = yes\n"
        "name = tifusi-l2tp\n"
        "pppoptfile = /etc/ppp/options.xl2tpd\n"
        "length bit = yes\n"
    )


def _ppp_options() -> str:
    lines = [
        # Must match both xl2tpd.conf's `name` (which client CHAP requests
        # get authenticated against) and chap-secrets' "server" column —
        # without this, pppd defaults to presenting the container's own
        # hostname as its identity, which matches neither, and CHAP auth
        # fails even though the IPsec/L2TP tunnel itself came up fine.
        "name tifusi-l2tp",
        "+mschap-v2",
        "ipcp-accept-local",
        "ipcp-accept-remote",
        "noccp",
        "auth",
        "mtu 1280",
        "mru 1280",
        "proxyarp",
        "lcp-echo-failure 4",
        "lcp-echo-interval 30",
        "connect-delay 5000",
    ]
    lines += [f"ms-dns {dns}" for dns in _DNS_SERVERS]
    return "\n".join(lines) + "\n"


def _chap_secrets(users: list[dict]) -> str:
    lines = ["# Managed by the Tifusi node agent — edits here are overwritten on every sync."]
    for u in users:
        username = str(u.get("username", "")).replace('"', "")
        password = str(u.get("password", "")).replace('"', "")
        if not username or not password:
            continue
        lines.append(f'"{username}" tifusi-l2tp "{password}" *')
    return "\n".join(lines) + "\n"


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    """check=False only swallows a *nonzero exit* — a genuinely missing
    binary still raises FileNotFoundError, which must never bubble out of
    here: /health calls into this (via is_ipsec_running), and a status
    endpoint crashing outright is worse than it just reporting not-running."""
    try:
        return subprocess.run(cmd, check=False, capture_output=True, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return subprocess.CompletedProcess(cmd, returncode=127)


def _ensure_forwarding_and_nat(subnet_cidr: str) -> None:
    _run(["sysctl", "-w", "net.ipv4.ip_forward=1"])
    # -C (check) first — iptables has no "insert if missing" primitive, and
    # this runs on every sync, so without the check a rule would be added
    # again on every single push.
    check = _run(["iptables", "-t", "nat", "-C", "POSTROUTING", "-s", subnet_cidr, "-j", "MASQUERADE"])
    if check.returncode != 0:
        _run(["iptables", "-t", "nat", "-A", "POSTROUTING", "-s", subnet_cidr, "-j", "MASQUERADE"])

    # A NAT rule alone isn't enough on a Docker host — Docker manages the
    # FORWARD chain itself and its default policy is commonly DROP, which
    # silently swallows traffic to/from an interface it doesn't know about
    # (xl2tpd's ppp0, charon's IPsec-protected traffic) even though
    # MASQUERADE above is correctly configured. -I (insert at the top),
    # not -A, so this wins over any DROP further down the chain.
    for direction in ("-s", "-d"):
        check = _run(["iptables", "-C", "FORWARD", direction, subnet_cidr, "-j", "ACCEPT"])
        if check.returncode != 0:
            _run(["iptables", "-I", "FORWARD", "1", direction, subnet_cidr, "-j", "ACCEPT"])


_charon_process: subprocess.Popen | None = None


def _restart_charon() -> None:
    """No `ipsec restart` here — this build has no starter/ipsec CLI (see
    module docstring), so charon is managed directly, the same way
    xl2tpd is below. A missing charon binary raises FileNotFoundError,
    same as xray's own Popen call in main.py, so callers can report it
    the same way instead of silently doing nothing."""
    global _charon_process
    if _charon_process is not None and _charon_process.poll() is None:
        _charon_process.terminate()
        try:
            _charon_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _charon_process.kill()
    _charon_process = subprocess.Popen([CHARON_BIN])


_xl2tpd_process: subprocess.Popen | None = None


def _restart_xl2tpd() -> None:
    global _xl2tpd_process
    if _xl2tpd_process is not None and _xl2tpd_process.poll() is None:
        _xl2tpd_process.terminate()
        try:
            _xl2tpd_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _xl2tpd_process.kill()
    # xl2tpd expects /var/run/xl2tpd to already exist so it can create its
    # control fifo there — on Debian this comes from a systemd tmpfiles.d
    # rule we don't have, so xl2tpd otherwise fails with "Unable to open
    # /var/run/xl2tpd/l2tp-control for reading" (confirmed live).
    Path("/var/run/xl2tpd").mkdir(parents=True, exist_ok=True)
    _xl2tpd_process = subprocess.Popen(["xl2tpd", "-D"])


def _load_swanctl_config(
    core_type: str,
    psk: str,
    remote_id: str | None = None,
    users: list[dict] | None = None,
    certificate: str | None = None,
    certificate_key: str | None = None,
    ikev2_auth_mode: str = "eap",
) -> None:
    if core_type == "ikev2" and ikev2_auth_mode != "psk":
        _ensure_ikev2_cert(remote_id or "", certificate, certificate_key)
    _write(SWANCTL_CONF, _swanctl_conf(core_type, psk, remote_id, users, ikev2_auth_mode), mode=0o600)
    _restart_charon()

    # charon takes a moment after being spawned to actually open its vici
    # socket — calling --load-all immediately can hit that window, fail
    # silently (nothing checked its exit code before), and leave charon
    # running with zero connections loaded, so every real handshake gets
    # rejected with NO_PROPOSAL_CHOSEN. Retry for a few seconds instead of
    # once. Bounded well under sync_node's 8s httpx timeout
    # (app/nodes/sync.py) — vici is normally ready in a second or two, so
    # this only ever runs long on a genuinely broken node, and even then
    # the panel should hear back "not running" rather than time out.
    for attempt in range(5):
        if _run(["swanctl", "--load-all"]).returncode == 0:
            break
        time.sleep(1)


def apply_l2tp(psk: str, users: list[dict], egress_vless: str | None = None) -> None:
    _load_swanctl_config("l2tp", psk)
    _write(XL2TPD_CONF, _xl2tpd_conf())
    _write(PPP_OPTIONS, _ppp_options())
    _write(CHAP_SECRETS, _chap_secrets(users), mode=0o600)
    _ensure_forwarding_and_nat(_L2TP_SUBNET)
    # Chained egress (see vless_egress.py) layers TPROXY rules on top of the
    # plain NAT/FORWARD ones above, which are harmless to leave in place —
    # TPROXY diverts matching packets before they'd ever reach them. Best
    # effort: a bad/unreachable egress link, or a host missing some
    # TPROXY-related tool, must never take down l2tp itself — worst case
    # without this try/except, an exception here would skip the
    # _restart_xl2tpd() call below entirely and silently break every l2tp
    # user, egress or not. Traffic just falls back to the plain NAT egress
    # already set up above.
    try:
        vless_egress.apply(egress_vless, _L2TP_SUBNET)
    except Exception:
        pass
    _restart_xl2tpd()


def apply_ikev2(
    psk: str,
    remote_id: str | None,
    users: list[dict],
    certificate: str | None = None,
    certificate_key: str | None = None,
    egress_vless: str | None = None,
    ikev2_auth_mode: str = "eap",
) -> None:
    _load_swanctl_config("ikev2", psk, remote_id, users, certificate, certificate_key, ikev2_auth_mode)
    _ensure_forwarding_and_nat(_IKEV2_SUBNET)
    # Chained egress (see vless_egress.py) — same mechanism apply_l2tp uses,
    # just against the ikev2 subnet. A node's l2tp/ikev2 slot is exclusive
    # (app/cores/resolve.py resolves it to one Core), so the two never both
    # try to run the shared TPROXY egress process at once. Best effort: a
    # bad/unreachable egress link must never take down ikev2 itself.
    try:
        vless_egress.apply(egress_vless, _IKEV2_SUBNET)
    except Exception:
        pass


def is_ipsec_running() -> bool:
    # strongSwan 6 dropped the stroke interface `ipsec status` used to
    # query — swanctl talks to charon over vici instead, and returns
    # nonzero if it can't even reach it (charon down, or never started).
    return _run(["swanctl", "--list-conns"]).returncode == 0


def is_xl2tpd_running() -> bool:
    return _xl2tpd_process is not None and _xl2tpd_process.poll() is None
