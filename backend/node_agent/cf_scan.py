"""Clean Cloudflare edge-IP scanner, run on the node.

For a VLESS host that uses plain TLS behind Cloudflare (rather than REALITY),
what decides whether it is fast is *which Cloudflare edge IP* the client dials:
Cloudflare answers every one of its proxied domains from every edge address
(anycast), so any IP in Cloudflare's own ranges serves the admin's domain, but
on a given Iranian operator some of those edges are fast and clean while others
are congested or filtered. This finds the fast, reachable ones.

It follows the same rules as this project's REALITY scanner: discovery is live
and never a stored list — Cloudflare's official IPv4 ranges are fetched fresh on
every run and a *random* sample of individual edge IPs is drawn from them, so no
two scans need see the same addresses and nothing is ever baked into the source.
Ranking is by real speed, not mere reachability: the node times each edge's TLS
handshake here, and the panel then asks probes inside Iran how each one performs
from there (app/reality/iran_check.py), which is the number that actually orders
the results — "it answers" is only the minimum bar.

The node half stops once it has a timed, working set (state "checking"); the
panel layers the Iran verdicts on top. A later step measures real throughput
from a phone, the same way the REALITY field test already does.
"""

import asyncio
import ipaddress
import random
import ssl
import time
import urllib.request
from contextlib import suppress
from dataclasses import asdict, dataclass, field

# Cloudflare publishes its edge ranges here and keeps this current; fetched every
# run so the scanner never carries a list of its own that could go stale or turn
# into the kind of predetermined set this project deliberately avoids.
CF_IPS_URL = "https://www.cloudflare.com/ips-v4"
_FETCH_TIMEOUT = 10
_CONNECT_TIMEOUT = 4.0
_CONCURRENCY = 32
# How many random edge IPs a single scan draws from Cloudflare's ranges.
_SAMPLE = 60


@dataclass
class CfCandidate:
    ip: str
    tls: str | None = None
    alpn: str | None = None
    # node -> edge TLS handshake, median of a few, measured warm. The first
    # ordering key before Iran has spoken.
    latency_ms: int | None = None
    usable: bool = False
    error: str | None = None


@dataclass
class CfJob:
    state: str = "idle"  # idle | fetching | probing | done | error
    phase_total: int = 0
    phase_done: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None
    sni: str | None = None
    candidates: dict[str, CfCandidate] = field(default_factory=dict)

    def snapshot(self) -> dict:
        items = sorted(self.candidates.values(), key=lambda c: (not c.usable, c.latency_ms or 10**6))
        return {
            "state": self.state,
            "phase_total": self.phase_total,
            "phase_done": self.phase_done,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "sni": self.sni,
            "results": [asdict(c) for c in items],
        }


_job = CfJob()
_task: asyncio.Task | None = None


def status() -> dict:
    return _job.snapshot()


def running() -> bool:
    return _task is not None and not _task.done()


def start(sni: str | None = None, sample: int = _SAMPLE) -> None:
    global _job, _task
    _job = CfJob(state="fetching", started_at=time.time(), sni=(sni or None))
    _task = asyncio.get_running_loop().create_task(_run(sni, max(1, min(sample, 300))))


async def _run(sni: str | None, sample: int) -> None:
    try:
        nets = await asyncio.to_thread(_fetch_ranges)
        if not nets:
            raise RuntimeError("could not fetch Cloudflare IP ranges")
        ips = _sample_ips(nets, sample)
        for ip in ips:
            _job.candidates[ip] = CfCandidate(ip=ip)
        _job.state = "probing"
        await _probe_all(sni)
        # Done from the node's side: unlike the REALITY scanner there is no
        # second on-node phase, the panel just keeps layering Iran verdicts
        # onto a finished result set on each poll.
        _job.state = "done"
    except Exception as exc:  # noqa: BLE001 - reported to the panel, not raised
        _job.state, _job.error = "error", str(exc)[:300]
    finally:
        _job.finished_at = time.time()


def _fetch_ranges() -> list[ipaddress.IPv4Network]:
    req = urllib.request.Request(CF_IPS_URL, headers={"User-Agent": "TifusiPanel-node"})
    with urllib.request.urlopen(req, timeout=_FETCH_TIMEOUT) as resp:
        text = resp.read().decode("ascii", "ignore")
    nets: list[ipaddress.IPv4Network] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        with suppress(ValueError):
            nets.append(ipaddress.ip_network(line, strict=False))
    return nets


def _sample_ips(nets: list[ipaddress.IPv4Network], count: int) -> list[str]:
    """A uniform random draw of individual host IPs from across Cloudflare's
    ranges — weighted by block size so a /13 contributes proportionally more
    than a /22, which is what an even spread over the real address space means.
    Network and broadcast addresses are skipped."""
    weighted = [(net, net.num_addresses) for net in nets if net.num_addresses > 2]
    total = sum(w for _, w in weighted)
    if not total:
        return []
    seen: set[str] = set()
    out: list[str] = []
    attempts = 0
    while len(out) < count and attempts < count * 40:
        attempts += 1
        pick = random.randrange(total)
        acc = 0
        for net, w in weighted:
            acc += w
            if pick < acc:
                offset = random.randrange(1, net.num_addresses - 1)
                ip = str(net.network_address + offset)
                if ip not in seen:
                    seen.add(ip)
                    out.append(ip)
                break
    return out


async def _probe_all(sni: str | None) -> None:
    items = list(_job.candidates.values())
    _job.phase_total, _job.phase_done = len(items), 0
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def one(c: CfCandidate) -> None:
        async with sem:
            await _probe(c, sni)
        _job.phase_done += 1

    await asyncio.gather(*(one(c) for c in items))


async def _tls_once(ip: str, sni: str | None) -> tuple[str | None, str | None] | None:
    ctx = ssl.create_default_context()
    # The edge is addressed by IP and may be probed with no domain or with one
    # it does not hold a matching cert for; we are measuring the path to the
    # edge, not validating a certificate, so verification is off here.
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.set_alpn_protocols(["h2", "http/1.1"])
    writer = None
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, 443, ssl=ctx, server_hostname=(sni or "cloudflare.com")),
            timeout=_CONNECT_TIMEOUT,
        )
        obj = writer.get_extra_info("ssl_object")
        return obj.version(), obj.selected_alpn_protocol()
    finally:
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()


async def _probe(c: CfCandidate, sni: str | None) -> None:
    times: list[float] = []
    tls = alpn = None
    for _ in range(3):
        start = time.monotonic()
        try:
            res = await _tls_once(c.ip, sni)
        except Exception as exc:  # noqa: BLE001
            c.error = (str(exc) or exc.__class__.__name__)[:120]
            return
        times.append((time.monotonic() - start) * 1000)
        tls, alpn = res
    c.tls, c.alpn = tls, alpn
    times.sort()
    c.latency_ms = round(times[len(times) // 2])
    # A real Cloudflare edge speaks TLS 1.3; requiring it drops anything that
    # answered 443 but is not actually a healthy edge.
    c.usable = tls == "TLSv1.3"
    if not c.usable:
        c.error = "no TLS 1.3"
