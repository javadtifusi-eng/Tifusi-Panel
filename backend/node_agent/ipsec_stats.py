"""Per-user traffic for IKEv2 and L2TP users. Their packets never pass
through Xray, so its StatsService (what /stats reads for VLESS and the other
Xray protocols) never sees them.

- IKEv2 (EAP): every installed CHILD_SA in `swanctl --list-sas --raw`
  carries bytes-in/bytes-out, and its IKE_SA carries the EAP identity,
  which is the panel username.
- L2TP: each pppd session is a pppN interface. The ip-up hook below records
  which user a session belongs to; /sys/class/net/pppN/statistics has its
  live counters, and the ip-down hook leaves the final totals behind when
  the session ends, so bytes since the last read aren't lost at disconnect.

read_deltas() returns bytes since the previous call, the same contract
Xray's `statsquery -reset` gives /stats. The very first call after the
agent starts only records a baseline: sessions already up then were
partly counted by the previous agent process, and counting their totals
again would double them.
"""

import re
import subprocess
import time
from pathlib import Path

PPP_STATE_DIR = Path("/run/tifusi-ppp")
_CLOSED_LOG = PPP_STATE_DIR / "closed.log"

_IP_UP_HOOK = Path("/etc/ppp/ip-up.d/tifusi-accounting")
_IP_DOWN_HOOK = Path("/etc/ppp/ip-down.d/tifusi-accounting")

# pppd passes PEERNAME (the authenticated username), and at ip-down also
# BYTES_RCVD/BYTES_SENT for the whole session. The token tells two sessions
# apart that happen to reuse the same pppN name, and orders them for
# node_agent/limits.py, which hangs up the newest past a user's limit via PPPD_PID.
_IP_UP_SCRIPT = f"""#!/bin/sh
# Managed by the Tifusi node agent (node_agent/ipsec_stats.py).
mkdir -p {PPP_STATE_DIR}
printf '%s %s %s\\n' "$PEERNAME" "$(date +%s%N)" "${{PPPD_PID:-}}" > "{PPP_STATE_DIR}/$PPP_IFACE"
"""

_IP_DOWN_SCRIPT = f"""#!/bin/sh
# Managed by the Tifusi node agent (node_agent/ipsec_stats.py).
[ -f "{PPP_STATE_DIR}/$PPP_IFACE" ] || exit 0
read -r user token _pid < "{PPP_STATE_DIR}/$PPP_IFACE"
printf '%s %s %s %s %s\\n' "$PPP_IFACE" "$user" "$token" "${{BYTES_RCVD:-0}}" "${{BYTES_SENT:-0}}" >> "{_CLOSED_LOG}"
rm -f "{PPP_STATE_DIR}/$PPP_IFACE"
"""

_IKE_CONN = re.compile(r"^list-sa event \{([^ {]+) \{")
_EAP_ID = re.compile(r"\bremote-eap-id=([^ {}]+)")
_REMOTE_ID = re.compile(r"\bremote-id=([^ {}]+)")
_CHILD = re.compile(r"\bname=\S+ uniqueid=(\d+)[^{}]*?\bbytes-in=(\d+)[^{}]*?\bbytes-out=(\d+)")

# key -> (bytes in, bytes out) as of the previous read.
_last: dict[str, tuple[int, int]] = {}
_primed = False


def install_ppp_hooks() -> None:
    for path, script in ((_IP_UP_HOOK, _IP_UP_SCRIPT), (_IP_DOWN_HOOK, _IP_DOWN_SCRIPT)):
        if not path.parent.is_dir():
            continue
        if not path.exists() or path.read_text() != script:
            path.write_text(script)
        path.chmod(0o755)


def _ikev2_counters() -> dict[str, tuple[str, int, int]]:
    """CHILD_SA key -> (username, bytes in, bytes out)."""
    try:
        out = subprocess.run(["swanctl", "--list-sas", "--raw"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return {}
    counters: dict[str, tuple[str, int, int]] = {}
    for line in out.splitlines():
        conn = _IKE_CONN.match(line)
        # The L2TP transport SA and the PSK/certificate-only IKEv2 modes have
        # no per-user identity; L2TP is counted per ppp session instead.
        if conn is None or not conn.group(1).startswith("ikev2"):
            continue
        identity = _EAP_ID.search(line) or _REMOTE_ID.search(line)
        if identity is None:
            continue
        username = identity.group(1).strip("'\"")
        for child in _CHILD.finditer(line):
            counters[f"ike:{child.group(1)}"] = (username, int(child.group(2)), int(child.group(3)))
    return counters


def _ppp_counters() -> dict[str, tuple[str, int, int]]:
    """Live ppp session key -> (username, bytes received, bytes sent)."""
    counters: dict[str, tuple[str, int, int]] = {}
    if not PPP_STATE_DIR.is_dir():
        return counters
    for state in PPP_STATE_DIR.iterdir():
        if not state.name.startswith("ppp"):
            continue
        try:
            username, token = state.read_text().split()[:2]
            stats = Path("/sys/class/net") / state.name / "statistics"
            rx = int((stats / "rx_bytes").read_text())
            tx = int((stats / "tx_bytes").read_text())
        except (OSError, ValueError):
            continue
        counters[f"ppp:{state.name}:{token}"] = (username, rx, tx)
    return counters


def _closed_ppp_sessions() -> list[tuple[str, str, int, int]]:
    """(key, username, final bytes received, final bytes sent) for sessions
    that ended since the previous read. The log is moved aside before it is
    read, so a session closing meanwhile lands in a fresh one."""
    if not _CLOSED_LOG.exists():
        return []
    taken = _CLOSED_LOG.with_name(f"closed.{time.time_ns()}.log")
    try:
        _CLOSED_LOG.rename(taken)
        lines = taken.read_text().splitlines()
        taken.unlink()
    except OSError:
        return []
    sessions = []
    for line in lines:
        try:
            iface, username, token, rcvd, sent = line.split()
            sessions.append((f"ppp:{iface}:{token}", username, int(rcvd), int(sent)))
        except ValueError:
            continue
    return sessions


def read_deltas() -> dict[str, tuple[int, int]]:
    """username -> (uplink bytes, downlink bytes) since the previous call."""
    global _primed
    live = {**_ikev2_counters(), **_ppp_counters()}
    closed = _closed_ppp_sessions()

    deltas: dict[str, tuple[int, int]] = {}

    def add(username: str, up: int, down: int) -> None:
        if up <= 0 and down <= 0:
            return
        prev_up, prev_down = deltas.get(username, (0, 0))
        deltas[username] = (prev_up + max(up, 0), prev_down + max(down, 0))

    for key, (username, bytes_in, bytes_out) in live.items():
        last_in, last_out = _last.get(key, (0, 0))
        # Lower than last time means the counter started over (a rekeyed or
        # replaced SA reusing the key): everything it holds now is new.
        add(username, bytes_in - last_in if bytes_in >= last_in else bytes_in, bytes_out - last_out if bytes_out >= last_out else bytes_out)
    for key, username, rcvd, sent in closed:
        last_in, last_out = _last.pop(key, (0, 0))
        add(username, rcvd - last_in, sent - last_out)

    # Forget sessions that are gone, keep the rest as the next baseline.
    _last.clear()
    _last.update({key: (bytes_in, bytes_out) for key, (_, bytes_in, bytes_out) in live.items()})

    if not _primed:
        _primed = True
        return {}
    return deltas
