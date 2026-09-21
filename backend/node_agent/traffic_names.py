"""SNI candidates taken from where this node's own users actually go.

Neighbours in the node's datacenter make fine REALITY targets on most
networks, but on MCI they carried REALITY's upload at well under 1 Mbps: an
operator that runs a whitelist has never seen a name like that, and a name it
has never seen is the one it throttles. The names an operator cannot afford to
slow down are the ones its own subscribers open all day, and this node already
sees them: every VLESS connection in Xray's access log names where the phone
went. Clients mostly send an address rather than a name (tcp:151.101.3.6:443),
so the scanner reads the name off that server's certificate, exactly as it
does for a neighbour.

So the access log is also read for that: HTTPS destinations only, counted by
how many different users opened each one. Only the destination and a count
are kept, never who went where, and only in memory plus a small file so a
restart doesn't start from nothing. The scanner then puts them through the
same checks as a neighbour — TLS 1.3 and HTTP/2 from the node, open from Iran,
then the phone — so this only widens what gets tested.
"""

import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path

_FILE = Path(os.environ.get("TRAFFIC_NAMES_FILE", "./data/traffic-names.json")).resolve()
# " accepted tcp:151.101.3.6:443 [...]" or " accepted tcp:www.example.com:443 [...]"
_DEST = re.compile(r" accepted tcp:([a-z0-9][a-z0-9.-]*\.[a-z0-9]+):443 ", re.IGNORECASE)
_KEEP_SECONDS = 7 * 86400
_MAX_NAMES = 3000
_SAVE_EVERY = 300

_lock = threading.Lock()
# name or IPv4 address -> {user hash: last seen}
_names: dict[str, dict[str, float]] = {}
_saved_at = 0.0


def _load() -> None:
    try:
        raw = json.loads(_FILE.read_text())
    except (OSError, ValueError):
        return
    if isinstance(raw, dict):
        _names.update({k: v for k, v in raw.items() if isinstance(v, dict)})


_load()


def record(line: str, user: str) -> None:
    match = _DEST.search(line)
    if not match:
        return
    name = match.group(1).lower().rstrip(".")
    # A hash rather than the username: only how many different users matters.
    who = hashlib.sha256(user.encode()).hexdigest()[:12]
    with _lock:
        _names.setdefault(name, {})[who] = time.time()


def flush() -> None:
    """Drop what is too old or too rare to matter, and save now and then."""
    global _saved_at
    now = time.time()
    with _lock:
        for name in list(_names):
            users = {u: t for u, t in _names[name].items() if now - t < _KEEP_SECONDS}
            if users:
                _names[name] = users
            else:
                del _names[name]
        if len(_names) > _MAX_NAMES:
            for name in sorted(_names, key=lambda n: len(_names[n]))[: len(_names) - _MAX_NAMES]:
                del _names[name]
        if now - _saved_at < _SAVE_EVERY:
            return
        _saved_at = now
        snapshot = json.dumps(_names)
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(snapshot)
    except OSError:
        pass


def top(limit: int) -> list[str]:
    """The destinations (names or addresses) the most different users opened, most first."""
    with _lock:
        ranked = sorted(_names.items(), key=lambda kv: (-len(kv[1]), -max(kv[1].values())))
    return [name for name, _ in ranked[:limit]]
