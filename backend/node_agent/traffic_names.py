"""SNI candidates sampled from what this node's users are doing right now — a
snapshot of the live wire, never a stored list.

Neighbours in the node's datacenter make fine REALITY targets on most networks,
but on MCI they carried REALITY's upload at well under 1 Mbps: an operator that
runs a whitelist has never seen a name like that, and a name it has never seen
is the one it throttles. The names an operator cannot afford to slow down are
the ones its own subscribers open all day, and this node already sees them:
every VLESS connection in Xray's access log names where the phone went.

A first version of this kept a growing, ranked file of every destination ever
seen and always offered the same "most popular" few back — which is exactly
the fixed, predetermined list this scanner exists to not be, just built by
code instead of typed by hand. There is no file and no memory across restarts
now: a destination only counts for the few minutes it is actually recent, and
a scan draws a plain random sample from whatever is in that short window at
the moment it runs. Two scans a minute apart can see a completely different
set, because they are looking at genuinely different traffic — that is the
point, not a bug to fix.

Clients mostly send an address rather than a name (tcp:151.101.3.6:443), so
the scanner reads the name off that server's certificate, exactly as it does
for a neighbour. Only the destination and a count of distinct users are kept,
in memory only, never who went where.
"""

import hashlib
import random
import re
import threading
import time

# " accepted tcp:151.101.3.6:443 [...]" or " accepted tcp:www.example.com:443 [...]"
_DEST = re.compile(r" accepted tcp:([a-z0-9][a-z0-9.-]*\.[a-z0-9]+):443 ", re.IGNORECASE)
# How "right now" is defined. Short on purpose: this is a snapshot of live
# traffic, not a history — a site nobody has opened in the last few minutes
# is not part of "what MCI's whitelist sees today" any more than one nobody
# ever opened.
_WINDOW_SECONDS = 5 * 60

_lock = threading.Lock()
# destination (name or address) -> {user hash: last seen}, pruned to the window on every read
_recent: dict[str, dict[str, float]] = {}


def record(line: str, user: str) -> None:
    match = _DEST.search(line)
    if not match:
        return
    name = match.group(1).lower().rstrip(".")
    # A hash rather than the username: only that some user did this matters.
    who = hashlib.sha256(user.encode()).hexdigest()[:12]
    with _lock:
        _recent.setdefault(name, {})[who] = time.time()


def sample(limit: int) -> list[str]:
    """A uniform random pick of up to `limit` destinations someone actually
    opened in the last few minutes. Not weighted by popularity — that would
    just reintroduce a predictable "usual suspects" list through the back
    door — and nothing here is remembered past the window, so this is only
    ever a photograph of the wire right now, taken fresh for this one scan."""
    now = time.time()
    with _lock:
        for name in list(_recent):
            users = {u: t for u, t in _recent[name].items() if now - t < _WINDOW_SECONDS}
            if users:
                _recent[name] = users
            else:
                del _recent[name]
        pool = list(_recent)
    random.shuffle(pool)
    return pool[:limit]
