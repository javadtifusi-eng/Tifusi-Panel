"""Holds each user to their simultaneous-connection limit (the panel's
hwid_limit) for every protocol this node terminates itself. Whoever is
already connected keeps their place; one more device is refused until one of
them disconnects. Nobody is banned.

- IKEv2 (EAP): IKE_SAs per EAP identity. The newest past the limit are
  terminated. PSK mode has no per-user identity, so it can't be limited.
- L2TP: ppp sessions per user, from the state ipsec_stats' ip-up hook keeps.
  The newest pppd past the limit is hung up.
- Xray: a device is a client IP, read from Xray's access log. Traffic from any
  further IP of that user is routed to a blackhole by a rule added over
  Xray's API. The rule matches the user *and* the IP: many unrelated
  customers share one carrier IP (CGNAT), and they must not be refused too.
  An IP stops counting once it has opened no connection for
  XRAY_IDLE_SECONDS, which is also how a refused device gets its turn.
"""

import json
import logging
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path

from node_agent import ipsec_stats

log = logging.getLogger("tifusi.limits")

ENFORCE_INTERVAL_SECONDS = 3
XRAY_IDLE_SECONDS = 90
XRAY_BLOCK_OUTBOUND = "tifusi-limit-block"
XRAY_ACCESS_LOG = Path(os.environ.get("XRAY_ACCESS_LOG", "./data/xray-access.log")).resolve()
XRAY_ERROR_LOG = Path(os.environ.get("XRAY_ERROR_LOG", "./data/xray-error.log")).resolve()
_ACCESS_LOG_ROTATE_BYTES = 8 * 1024 * 1024

_IKE_CONN = re.compile(r"^list-sa event \{(ikev2[^ {]*) \{")
_EAP_ID = re.compile(r"\bremote-eap-id=([^ {}]+)")
_IKE_UNIQUEID = re.compile(r"\buniqueid=(\d+)")
_IKE_ESTABLISHED = re.compile(r"\bestablished=(\d+)")
_IKE_STATE = re.compile(r"\bstate=(\w+)")
_ACCESS_LINE = re.compile(r" from (\S+) (?:accepted|rejected) .*? email: (\S+)")

_lock = threading.Lock()
_ipsec_limits: dict[str, int] = {}
_xray_limits: dict[str, int] = {}
_xray_base_rules: list[dict] = []
# user -> ip -> [first seen, last seen], monotonic seconds
_xray_ips: dict[str, dict[str, list[float]]] = {}
# The block rules currently loaded into the running Xray.
_xray_applied: list[dict] = []
# Bumped whenever Xray restarts, so a pass that started against the previous
# process doesn't record its connections or its rules against the new one.
_xray_generation = 0
_log_offset = 0
# IKE_SA uniqueids already found over the limit on the previous pass.
_ike_over: set[str] = set()


def _positive_limits(pairs) -> dict[str, int]:
    limits = {}
    for username, limit in pairs:
        try:
            limit = int(limit or 0)
        except (TypeError, ValueError):
            continue
        if username and limit > 0:
            limits[str(username)] = limit
    return limits


def set_ipsec_limits(users: list[dict]) -> None:
    global _ipsec_limits
    with _lock:
        _ipsec_limits = _positive_limits((u.get("username"), u.get("limit")) for u in users)


def prepare_xray_config(payload: dict) -> dict:
    """Takes the panel's limits out of the pushed config (Xray has no use for
    them) and adds what enforcing them needs: an access log, the Routing and
    Logger API services, and the blackhole outbound refused traffic goes to."""
    global _xray_limits, _xray_base_rules
    limits = payload.pop("tifusi_limits", None) or {}

    payload.setdefault("log", {})["access"] = str(XRAY_ACCESS_LOG)
    # Without this, Xray's own errors go to stdout and are kept nowhere: a
    # REALITY handshake a censor broke, or a client rejected, leaves no trace
    # at all, which is exactly what is needed to tell filtering from a bad
    # config. The access log alone only ever shows connections that worked.
    payload["log"].setdefault("error", str(XRAY_ERROR_LOG))
    api = payload.get("api")
    if isinstance(api, dict):
        services = api.setdefault("services", [])
        for service in ("RoutingService", "LoggerService"):
            if service not in services:
                services.append(service)
    outbounds = payload.setdefault("outbounds", [])
    if not any(o.get("tag") == XRAY_BLOCK_OUTBOUND for o in outbounds):
        # Appended, never inserted: the first outbound is Xray's default route.
        outbounds.append({"protocol": "blackhole", "tag": XRAY_BLOCK_OUTBOUND})

    with _lock:
        _xray_limits = _positive_limits(limits.items())
        _xray_base_rules = deepcopy(payload.get("routing", {}).get("rules", []))
    return payload


def xray_restarted() -> None:
    """A fresh Xray process has none of the runtime block rules and none of
    the old connections, so what was tracked for the previous one is void."""
    global _xray_applied, _xray_generation, _log_offset
    XRAY_ACCESS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        XRAY_ACCESS_LOG.write_bytes(b"")
        _xray_ips.clear()
        _xray_applied = []
        _xray_generation += 1
        _log_offset = 0


# ---------- IKEv2 ----------

def _enforce_ikev2() -> None:
    global _ike_over
    with _lock:
        limits = dict(_ipsec_limits)
    if not limits:
        _ike_over = set()
        return
    try:
        out = subprocess.run(["swanctl", "--list-sas", "--raw"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return

    sessions: dict[str, list[tuple[int, str]]] = {}
    for line in out.splitlines():
        if not _IKE_CONN.match(line):
            continue
        ike = line.split(" child-sas ", 1)[0]
        user = _EAP_ID.search(ike)
        uniqueid = _IKE_UNIQUEID.search(ike)
        state = _IKE_STATE.search(ike)
        if not user or not uniqueid or (state and state.group(1) != "ESTABLISHED"):
            continue
        established = _IKE_ESTABLISHED.search(ike)
        sessions.setdefault(user.group(1).strip("'\""), []).append(
            (int(established.group(1)) if established else 0, uniqueid.group(1))
        )

    over: set[str] = set()
    for username, sas in sessions.items():
        limit = limits.get(username)
        if not limit or len(sas) <= limit:
            continue
        # Longest established first: those keep their place.
        sas.sort(key=lambda sa: sa[0], reverse=True)
        over.update(uniqueid for _, uniqueid in sas[limit:])

    # Only terminate what was over the limit on two passes in a row: rekeying
    # briefly runs a replacement IKE_SA next to the one it replaces, and that
    # one device must not be cut off for it.
    for uniqueid in over & _ike_over:
        subprocess.run(["swanctl", "--terminate", "--ike-id", uniqueid, "--force"], capture_output=True, timeout=10)
    _ike_over = over


# ---------- L2TP ----------

def _pppd_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _pppd_pid(iface: str, recorded: str) -> int | None:
    candidates = [recorded] if recorded else []
    try:
        candidates.append(Path(f"/run/{iface}.pid").read_text().split()[0])
    except (OSError, IndexError):
        pass
    for candidate in candidates:
        if candidate.isdigit() and _pppd_alive(int(candidate)):
            return int(candidate)
    return None


def _enforce_l2tp() -> None:
    with _lock:
        limits = dict(_ipsec_limits)
    state_dir = ipsec_stats.PPP_STATE_DIR
    if not limits or not state_dir.is_dir():
        return

    sessions: dict[str, list[tuple[int, int]]] = {}
    for state in state_dir.iterdir():
        # A session whose interface is gone ended without ip-down running;
        # its leftover state must not hold one of the user's places forever.
        if not state.name.startswith("ppp") or not (Path("/sys/class/net") / state.name).exists():
            continue
        try:
            fields = state.read_text().split()
            username, token = fields[0], int(fields[1])
        except (OSError, IndexError, ValueError):
            continue
        pid = _pppd_pid(state.name, fields[2] if len(fields) > 2 else "")
        if username in limits and pid is not None:
            sessions.setdefault(username, []).append((token, pid))

    for username, ppp in sessions.items():
        limit = limits[username]
        if len(ppp) <= limit:
            continue
        ppp.sort()
        for _, pid in ppp[limit:]:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass


# ---------- Xray ----------

def _client_ip(source: str) -> str:
    if source[:4] in ("tcp:", "udp:"):
        source = source[4:]
    return source.rsplit(":", 1)[0].strip("[]")


def _read_access_log(xray_bin: str, api_addr: str) -> list[tuple[str, str]]:
    """(ip, username) for every connection logged since the previous read."""
    global _log_offset
    try:
        size = XRAY_ACCESS_LOG.stat().st_size
    except OSError:
        return []
    if size < _log_offset:
        _log_offset = 0

    raw = b""
    if size > _log_offset:
        with XRAY_ACCESS_LOG.open("rb") as f:
            f.seek(_log_offset)
            chunk = f.read()
        complete = chunk.rfind(b"\n") + 1
        raw = chunk[:complete]
        _log_offset += complete

    if _log_offset >= _ACCESS_LOG_ROTATE_BYTES:
        rotated = XRAY_ACCESS_LOG.with_name(XRAY_ACCESS_LOG.name + ".old")
        XRAY_ACCESS_LOG.rename(rotated)
        reopened = subprocess.run([xray_bin, "api", "restartlogger", f"-server={api_addr}"],
                                  capture_output=True, timeout=5).returncode == 0
        if reopened:
            with rotated.open("rb") as f:
                f.seek(_log_offset)
                raw += f.read()
            rotated.unlink()
            _log_offset = 0
        else:
            rotated.rename(XRAY_ACCESS_LOG)

    entries = []
    for line in raw.decode(errors="replace").splitlines():
        match = _ACCESS_LINE.search(line)
        if match:
            entries.append((_client_ip(match.group(1)), match.group(2)))
    return entries


def _apply_xray_rules(xray_bin: str, api_addr: str, rules: list[dict]) -> bool:
    # adrules without -append replaces the whole rule list, which is the only
    # way to get the block rules in front of the admin's own catch-all rules.
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"routing": {"rules": rules}}, f)
        path = f.name
    try:
        result = subprocess.run([xray_bin, "api", "adrules", f"-server={api_addr}", path],
                                capture_output=True, text=True, timeout=10)
    finally:
        os.unlink(path)
    if result.returncode != 0:
        log.warning("xray adrules failed: %s", (result.stderr or result.stdout).strip())
    return result.returncode == 0


def _enforce_xray(xray_bin: str, api_addr: str) -> None:
    global _xray_applied
    with _lock:
        generation = _xray_generation
    entries = _read_access_log(xray_bin, api_addr)
    now = time.monotonic()
    with _lock:
        if generation != _xray_generation:
            return
        for ip, username in entries:
            if username not in _xray_limits:
                continue
            seen = _xray_ips.setdefault(username, {}).get(ip)
            if seen is None:
                _xray_ips[username][ip] = [now, now]
            else:
                seen[1] = now
        for username in list(_xray_ips):
            ips = _xray_ips[username]
            for ip in [ip for ip, (_, last) in ips.items() if now - last > XRAY_IDLE_SECONDS]:
                del ips[ip]
            if not ips or username not in _xray_limits:
                del _xray_ips[username]

        wanted = []
        for username in sorted(_xray_ips):
            by_arrival = sorted(_xray_ips[username].items(), key=lambda item: item[1][0])
            refused = sorted(ip for ip, _ in by_arrival[_xray_limits[username]:])
            if refused:
                wanted.append({"type": "field", "ruleTag": f"tifusi-limit-{username}", "user": [username],
                               "source": refused, "outboundTag": XRAY_BLOCK_OUTBOUND})
        if wanted == _xray_applied:
            return
        rules = wanted + _xray_base_rules

    if _apply_xray_rules(xray_bin, api_addr, rules):
        with _lock:
            if generation == _xray_generation:
                _xray_applied = wanted


def start(xray_bin: str, api_addr: str, xray_running: Callable[[], bool]) -> None:
    def loop() -> None:
        while True:
            for enforce in (_enforce_ikev2, _enforce_l2tp):
                try:
                    enforce()
                except Exception:
                    log.exception("connection limit enforcement failed")
            if xray_running():
                try:
                    _enforce_xray(xray_bin, api_addr)
                except Exception:
                    log.exception("xray connection limit enforcement failed")
            time.sleep(ENFORCE_INTERVAL_SECONDS)

    threading.Thread(target=loop, name="tifusi-limits", daemon=True).start()
