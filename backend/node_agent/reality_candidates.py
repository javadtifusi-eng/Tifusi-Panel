"""REALITY target candidates, gathered on the node for a test on an Iranian
operator (the probe in backend/reality_probe measures them there).

Nothing here can tell whether an operator throttles a name — only a test
from inside Iran can. What this does is bring together names worth that
test, each tagged with where it came from, so the results also say which
*kind* of name an operator lets through:

- traffic: names this node's own users already reach through Xray. An
  operator's allow-list has demonstrably let them pass.
- seeds: names the admin keeps in the panel (never in this repository: a
  name published as a good REALITY target is the first one a censor
  blocks), grouped under the admin's own labels.
- tail: less-known sites from the Tranco list (rank 20k-500k), off the big
  CDNs — names an operator has no address list to check against.
- control: a few of the best-known names, so a run also says whether
  popularity itself is what gets throttled.
- winners: names that worked before, sent by the panel.

Datacenter neighbours are deliberately absent: tested from inside Iran they
were throttled even when they looked fine from the node.

Every name must speak TLS 1.3 and HTTP/2 with a valid certificate from the
node, since the node is what forwards unauthenticated REALITY handshakes to
it. X25519 is not required.
"""

import asyncio
import io
import ipaddress
import random
import re
import socket
import ssl
import time
import urllib.request
import zipfile
from collections import Counter
from contextlib import suppress
from pathlib import Path

ACCESS_LOG = Path("/app/data/xray-access.log")
_TRANCO_URL = "https://tranco-list.eu/top-1m.csv.zip"
_TAIL_RANKS = (20_000, 500_000)

CONTROL = ["www.microsoft.com", "www.apple.com", "www.speedtest.net", "www.amazon.com", "www.samsung.com"]

# Names on these networks share addresses with thousands of other sites, so
# an operator can (and does) judge them by their published ranges.
_CDN_RANGE_URLS = [
    "https://www.cloudflare.com/ips-v4",
    "https://api.fastly.com/public-ip-list",
    "https://www.gstatic.com/ipranges/goog.json",
    "https://ip-ranges.amazonaws.com/ip-ranges.json",
]
_IPV4_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}/\d{1,2}\b")
_HOST_RE = re.compile(r"accepted (?:tcp|udp):([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}):443\b")

_TIMEOUT = 5.0
_CONCURRENCY = 64
_CAPS = {"traffic": 60, "seed": 60, "tail": 60, "control": 5, "winners": 40}


def _fetch(url: str, timeout: int = 45) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "TifusiPanel-node"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https URLs
        return resp.read()


def _cdn_networks() -> list[ipaddress.IPv4Network]:
    nets = []
    for url in _CDN_RANGE_URLS:
        with suppress(Exception):
            for cidr in _IPV4_RE.findall(_fetch(url, 15).decode(errors="ignore")):
                with suppress(ValueError):
                    nets.append(ipaddress.IPv4Network(cidr, strict=False))
    return nets


def _traffic_names(limit: int) -> list[str]:
    """The most-used full host names from Xray's access log, one per
    registrable domain so a single site can't fill the list."""
    counts: Counter[str] = Counter()
    with suppress(OSError), ACCESS_LOG.open(errors="replace") as f:
        for line in f:
            m = _HOST_RE.search(line)
            if m:
                counts[m.group(1).lower()] += 1
    seen: set[str] = set()
    out = []
    for host, _ in counts.most_common():
        base = ".".join(host.split(".")[-2:])
        if base in seen:
            continue
        seen.add(base)
        out.append(host)
        if len(out) >= limit * 2:
            break
    return out


def _tail_names(count: int) -> list[str]:
    blob = _fetch(_TRANCO_URL)
    lo, hi = _TAIL_RANKS
    picks = set(random.sample(range(lo, hi), count))
    out = []
    zf = zipfile.ZipFile(io.BytesIO(blob))
    with zf.open(zf.namelist()[0]) as f:
        for n, line in enumerate(io.TextIOWrapper(f, encoding="ascii", errors="ignore")):
            if n >= hi:
                break
            if n in picks:
                parts = line.strip().split(",")
                if len(parts) >= 2 and parts[1]:
                    out.append(parts[1].lower())
    return out


def _ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ctx.set_alpn_protocols(["h2"])
    return ctx


_CTX = _ctx()


async def _check(host: str) -> dict | None:
    """TLS 1.3 + h2 with a verified certificate, straight from the node.
    IPv4 only: the CDN ranges are IPv4, and so is what Xray dials first."""
    start = time.monotonic()
    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, 443, ssl=_CTX, server_hostname=host, family=socket.AF_INET), timeout=_TIMEOUT
        )
        sslobj = writer.get_extra_info("ssl_object")
        if sslobj is None or sslobj.version() != "TLSv1.3" or sslobj.selected_alpn_protocol() != "h2":
            return None
        peer = writer.get_extra_info("peername")
        return {"host": host, "ip": peer[0] if peer else None, "ms": round((time.monotonic() - start) * 1000)}
    except Exception:  # noqa: BLE001 - any failure just drops the name
        return None
    finally:
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await asyncio.wait_for(writer.wait_closed(), 2)


async def collect(winners: list[str] | None = None, seeds: dict[str, list[str]] | None = None,
                  tail_sample: int = 400) -> dict:
    """Gathers, validates and returns candidates grouped by source. `seeds`
    is {label: [names]} from the panel; each name is tagged "seed" and keeps
    its label."""
    started = time.monotonic()
    loop = asyncio.get_running_loop()
    tail_task = loop.run_in_executor(None, _tail_names, tail_sample)
    cdn_task = loop.run_in_executor(None, _cdn_networks)
    sources: dict[str, list[str]] = {
        "winners": [w.strip().lower() for w in (winners or []) if w and w.strip()],
        "seed": [h.strip().lower() for names in (seeds or {}).values() for h in names if h and h.strip()],
        "control": list(CONTROL),
        "traffic": await loop.run_in_executor(None, _traffic_names, _CAPS["traffic"]),
    }
    errors = []
    try:
        sources["tail"] = await tail_task
    except Exception as exc:  # noqa: BLE001
        sources["tail"] = []
        errors.append(f"tranco: {exc.__class__.__name__}")
    cdn = await cdn_task

    # A name keeps the first (most specific) source it was found in.
    order = ["winners", "seed", "control", "traffic", "tail"]
    labels = {h.strip().lower(): label for label, names in (seeds or {}).items() for h in names if h and h.strip()}
    tagged: dict[str, str] = {}
    for src in order:
        for host in sources[src]:
            tagged.setdefault(host, src)

    sem = asyncio.Semaphore(_CONCURRENCY)

    async def one(host: str):
        async with sem:
            return await _check(host)

    checked = await asyncio.gather(*(one(h) for h in tagged))
    out: list[dict] = []
    per_source: Counter[str] = Counter()
    for res in checked:
        if not res:
            continue
        src = tagged[res["host"]]
        on_cdn = False
        with suppress(ValueError, TypeError):
            ip = ipaddress.IPv4Address(res["ip"])
            on_cdn = any(ip in n for n in cdn)
        # The long tail is only worth it off the big CDNs; elsewhere the CDN
        # flag is kept as information for the results page.
        if src == "tail" and on_cdn:
            continue
        if per_source[src] >= _CAPS[src]:
            continue
        per_source[src] += 1
        out.append({**res, "source": src, "label": labels.get(res["host"]) if src == "seed" else None, "cdn": on_cdn})
    out.sort(key=lambda c: (order.index(c["source"]), c["ms"]))
    return {
        "candidates": out,
        "checked": len(tagged),
        "by_source": dict(per_source),
        "errors": errors,
        "seconds": round(time.monotonic() - started, 1),
    }
