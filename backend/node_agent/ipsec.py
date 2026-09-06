"""Generates and applies real strongSwan/xl2tpd config for l2tp/ikev2 cores.

Only ever touched when the panel assigns this node an l2tp or ikev2 Core —
a plain Xray node never calls anything here. The conn stanzas below mirror
the well-established public reference for PSK-based IPsec VPN servers
(hwdsl2/setup-ipsec-vpn), not something invented from scratch, since a
wrong IPsec conn silently fails to negotiate in ways that are miserable to
debug from a client.

Everything here (the daemons *and* their config) lives inside this node's
own container — only the network namespace is shared with the host (via
--network host in install-node.sh), which is what makes inbound UDP
500/1701/4500 on the host's public IP actually reach charon/xl2tpd here,
and what makes the sysctl/iptables calls below affect the real host
network stack instead of an isolated container-only one.
"""

import subprocess
from pathlib import Path

IPSEC_CONF = Path("/etc/ipsec.conf")
IPSEC_SECRETS = Path("/etc/ipsec.secrets")
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


def _ipsec_conf(core_type: str, remote_id: str | None = None) -> str:
    header = "config setup\n  uniqueids=no\n\n"
    if core_type == "l2tp":
        return header + (
            "conn l2tp-psk\n"
            "  auto=add\n"
            "  keyexchange=ikev1\n"
            "  authby=secret\n"
            "  type=transport\n"
            "  left=%defaultroute\n"
            "  leftprotoport=17/1701\n"
            "  right=%any\n"
            "  rightprotoport=17/%any\n"
            "  ike=aes256-sha2;modp2048,aes128-sha2;modp2048,aes256-sha1;modp2048,aes128-sha1;modp2048\n"
            "  phase2alg=aes_gcm-null,aes128-sha1,aes256-sha1,aes256-sha2_512,aes128-sha2,aes256-sha2\n"
            "  ikelifetime=8h\n"
            "  keylife=1h\n"
            "  rekey=no\n"
            "  dpddelay=30\n"
            "  dpdtimeout=300\n"
        )
    # ikev2 — raw PSK auth, no certs/EAP: matches this panel's one-shared-
    # secret design for this core type. leftid only matters if the admin
    # set a Remote ID — clients that fill in a "Remote ID" field must match
    # whatever this is, so it needs to be a real identity (the server's own
    # domain/IP), not left for strongSwan to default silently.
    leftid_line = f"  leftid={remote_id}\n" if remote_id else ""
    return header + (
        "conn ikev2-psk\n"
        "  auto=add\n"
        "  keyexchange=ikev2\n"
        "  left=%defaultroute\n"
        f"{leftid_line}"
        "  leftauth=psk\n"
        "  leftsubnet=0.0.0.0/0,::/0\n"
        "  right=%any\n"
        "  rightauth=psk\n"
        f"  rightsourceip={_IKEV2_POOL}\n"
        f"  rightdns={','.join(_DNS_SERVERS)}\n"
        "  ike=aes256-sha2;modp2048,aes128-sha2;modp2048,aes256gcm16-prfsha384-ecp384\n"
        "  dpddelay=30\n"
        "  dpdtimeout=300\n"
    )


def _ipsec_secrets(psk: str) -> str:
    # A blanket identity, not tied to any particular server/client id — the
    # standard shape for a single PSK shared by every client.
    escaped = psk.replace('"', '\\"')
    return f'%any %any : PSK "{escaped}"\n'


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


def _restart_ipsec() -> None:
    _run(["ipsec", "restart"])


_xl2tpd_process: subprocess.Popen | None = None


def _restart_xl2tpd() -> None:
    global _xl2tpd_process
    if _xl2tpd_process is not None and _xl2tpd_process.poll() is None:
        _xl2tpd_process.terminate()
        try:
            _xl2tpd_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _xl2tpd_process.kill()
    _xl2tpd_process = subprocess.Popen(["xl2tpd", "-D"])


def apply_l2tp(psk: str, users: list[dict]) -> None:
    _write(IPSEC_CONF, _ipsec_conf("l2tp"))
    _write(IPSEC_SECRETS, _ipsec_secrets(psk), mode=0o600)
    _write(XL2TPD_CONF, _xl2tpd_conf())
    _write(PPP_OPTIONS, _ppp_options())
    _write(CHAP_SECRETS, _chap_secrets(users), mode=0o600)
    _ensure_forwarding_and_nat(_L2TP_SUBNET)
    _restart_ipsec()
    _restart_xl2tpd()


def apply_ikev2(psk: str, remote_id: str | None) -> None:
    _write(IPSEC_CONF, _ipsec_conf("ikev2", remote_id))
    _write(IPSEC_SECRETS, _ipsec_secrets(psk), mode=0o600)
    _ensure_forwarding_and_nat(_IKEV2_SUBNET)
    _restart_ipsec()


def is_ipsec_running() -> bool:
    return _run(["ipsec", "status"]).returncode == 0


def is_xl2tpd_running() -> bool:
    return _xl2tpd_process is not None and _xl2tpd_process.poll() is None
