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

import subprocess
import time
from pathlib import Path

CHARON_BIN = "/usr/libexec/ipsec/charon"
SWANCTL_CONF = Path("/etc/swanctl/swanctl.conf")
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


def _swanctl_conf(core_type: str, psk: str, remote_id: str | None = None, users: list[dict] | None = None) -> str:
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
            "        local_ts = dynamic[/1701]\n"
            "        remote_ts = dynamic[/%any]\n"
            "        esp_proposals = aes256-sha1,aes128-sha1,aes256gcm16,3des-sha1\n"
            "      }\n"
            "    }\n"
            "  }\n"
            "}\n"
            "secrets {\n"
            f'  ike-l2tp {{ secret = "{escaped_psk}" }}\n'
            "}\n"
        )
    # ikev2 — the Core's PSK authenticates the SERVER to the client (IKE
    # local auth, `local.auth = psk`); each ProxyUser then authenticates
    # to the server over EAP-MSCHAPv2 with their own username/password
    # (`remote.auth = eap-mschapv2`), the same per-user login model as
    # l2tp instead of one shared secret nobody can be told apart by.
    # local.id only matters if the admin set a Remote ID — a client that
    # fills in a "Remote ID" field must match whatever this is, so it
    # needs to be a real identity (the server's own domain/IP), not left
    # for strongSwan to default silently.
    local_id_line = f"      id = {remote_id}\n" if remote_id else ""
    return (
        "connections {\n"
        "  ikev2-eap {\n"
        "    version = 2\n"
        "    proposals = aes256-sha256-modp2048,aes128-sha256-modp2048,aes256gcm16-prfsha384-ecp384\n"
        "    local_addrs = %any\n"
        "    remote_addrs = %any\n"
        "    local {\n"
        "      auth = psk\n"
        f"{local_id_line}"
        "    }\n"
        "    remote { auth = eap-mschapv2 }\n"
        "    children {\n"
        "      net {\n"
        "        local_ts = 0.0.0.0/0,::/0\n"
        "        esp_proposals = aes256gcm16-prfsha384-ecp384,aes256-sha256-modp2048,aes128-sha256-modp2048\n"
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
        f'  ike-ikev2 {{ secret = "{escaped_psk}" }}\n'
        f"{_eap_secrets(users or [])}"
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
    _xl2tpd_process = subprocess.Popen(["xl2tpd", "-D"])


def _load_swanctl_config(
    core_type: str, psk: str, remote_id: str | None = None, users: list[dict] | None = None
) -> None:
    _write(SWANCTL_CONF, _swanctl_conf(core_type, psk, remote_id, users), mode=0o600)
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


def apply_l2tp(psk: str, users: list[dict]) -> None:
    _load_swanctl_config("l2tp", psk)
    _write(XL2TPD_CONF, _xl2tpd_conf())
    _write(PPP_OPTIONS, _ppp_options())
    _write(CHAP_SECRETS, _chap_secrets(users), mode=0o600)
    _ensure_forwarding_and_nat(_L2TP_SUBNET)
    _restart_xl2tpd()


def apply_ikev2(psk: str, remote_id: str | None, users: list[dict]) -> None:
    _load_swanctl_config("ikev2", psk, remote_id, users)
    _ensure_forwarding_and_nat(_IKEV2_SUBNET)


def is_ipsec_running() -> bool:
    # strongSwan 6 dropped the stroke interface `ipsec status` used to
    # query — swanctl talks to charon over vici instead, and returns
    # nonzero if it can't even reach it (charon down, or never started).
    return _run(["swanctl", "--list-conns"]).returncode == 0


def is_xl2tpd_running() -> bool:
    return _xl2tpd_process is not None and _xl2tpd_process.poll() is None
