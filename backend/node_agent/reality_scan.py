"""REALITY target scanner, run on the node itself.

A REALITY dest has to work *from the node*: the node is the one that
forwards unauthenticated handshakes to it, so latency and reachability are
measured here, not on the panel. Every scan finds its own targets live —
there is no built-in list of names anywhere in this project, because a
name that is published as a good REALITY target is exactly the name a
censor gets to block first.

The scan runs in two halves, with the panel's Iran check in between:

1. discover: TLS-connect to every address in the node's own /24 and read
   the names off each certificate — neighbours in the same datacenter are
   the targets Xray's authors recommend;
2. validate: connect to each name with SNI and a verified certificate,
   keeping those that speak TLS 1.3 and HTTP/2, and time them.

The job then parks in `checking` while the panel asks probes inside Iran
which of the survivors are really open there (app/reality/iran_check.py).
Only the ones that are get the last step, because it costs about a minute
each and a name Iran blocks is worthless however well it tests here:

3. prove: start a real REALITY server and client on this node and fetch a
   page through it once per uTLS fingerprint. A fingerprint is marked
   working only if that page actually loaded, and is timed so the panel
   can rank fingerprints by speed rather than by merely working.
"""

import asyncio
import base64
import ipaddress
import json
import os
import random
import socket
import ssl
import tempfile
import time
import uuid
from contextlib import suppress
from dataclasses import asdict, dataclass, field

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

XRAY_BIN = os.environ.get("XRAY_BIN", "xray")

FINGERPRINTS = ["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized"]
PROBE_URL = "https://www.gstatic.com/generate_204"

_DISCOVER_TIMEOUT = 3.0
_DISCOVER_CONCURRENCY = 64
_VALIDATE_TIMEOUT = 5.0
_FETCH_TIMEOUT = 10


@dataclass
class Candidate:
    host: str
    ip: str | None = None
    source: str = "neighbor"
    tls: str | None = None
    alpn: str | None = None
    # REALITY hands every unauthenticated handshake to dest, and a client's
    # first packets wait on that round trip — so the node->dest times are
    # the ones that rank targets. rtt_ms: median TCP connect; latency_ms:
    # median full TLS handshake, both measured warm, by IP, from the node.
    rtt_ms: int | None = None
    latency_ms: int | None = None
    usable: bool = False
    error: str | None = None
    # What goes in realitySettings.dest: a neighbour is reached by its own
    # address, so the node's REALITY traffic stays inside the datacenter.
    dest: str | None = None
    # None until the real REALITY test has run for this host.
    fingerprints: dict[str, dict] | None = None


@dataclass
class Job:
    # checking: validated and timed, waiting for the panel's Iran verdicts
    # before the expensive per-fingerprint test runs on the survivors.
    state: str = "idle"  # idle | discovering | validating | checking | testing | done | error
    phase_total: int = 0
    phase_done: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None
    ring: int = 0
    blocks: list[str] = field(default_factory=list)
    candidates: dict[str, Candidate] = field(default_factory=dict)

    def snapshot(self) -> dict:
        items = sorted(self.candidates.values(), key=_rank)
        return {
            "state": self.state,
            "phase_total": self.phase_total,
            "phase_done": self.phase_done,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "ring": self.ring,
            "blocks": self.blocks,
            "results": [asdict(c) for c in items],
        }


def _rank(c: Candidate) -> tuple:
    """Speed first among the names that actually work. The panel re-sorts
    with the Iran verdicts it alone has, so this only has to put a sane
    order on the snapshot: proven-working, then chrome, then how long the
    handshake REALITY waits on for every new connection takes."""
    fps = c.fingerprints or {}
    tested = c.fingerprints is not None and any(r.get("ok") is not None for r in fps.values())
    working = [r for r in fps.values() if r.get("ok")]
    chrome = bool((fps.get("chrome") or {}).get("ok"))
    return (
        not c.usable,
        tested and not working,
        not chrome if tested else False,
        min([r["ms"] for r in working if r.get("ms")] or [10**6]),
        c.latency_ms or 10**6,
        -len(working),
    )


_job = Job()
_task: asyncio.Task | None = None


def status() -> dict:
    return _job.snapshot()


def running() -> bool:
    return _task is not None and not _task.done()


def start(public_ip: str | None, ring: int = 0, exclude: list[str] | None = None) -> None:
    global _job, _task
    _job = Job(state="discovering", started_at=time.time(), ring=ring)
    if public_ip:
        _job.blocks = [str(n) for n in ring_blocks(public_ip, ring)]
    _task = asyncio.get_running_loop().create_task(_run(public_ip, ring, set(exclude or [])))


async def _run(public_ip: str | None, ring: int = 0, exclude: set[str] | None = None) -> None:
    try:
        if public_ip:
            await _discover(public_ip, ring, exclude)
        _job.state = "validating"
        await _validate(list(_job.candidates.values()))
        await _measure_all(list(_job.candidates.values()))
        # Parked: the panel asks Iran about these and calls prove() back with
        # the ones that are open there. Nothing else is worth a minute of
        # REALITY testing.
        _job.state = "checking"
    except Exception as exc:  # noqa: BLE001 - reported to the panel, not raised
        _job.state, _job.error = "error", str(exc)[:300]
        _job.finished_at = time.time()


def prove_hosts(hosts: list[str]) -> None:
    """Second half, started by the panel once Iran has answered."""
    global _task
    _task = asyncio.get_running_loop().create_task(_prove_run(hosts))


async def _prove_run(hosts: list[str]) -> None:
    try:
        best = [c for c in (_job.candidates.get(h) for h in hosts) if c is not None and c.usable]
        _job.state = "testing"
        _job.phase_total, _job.phase_done = len(best), 0
        for c in best:
            c.fingerprints = {fp: {"ok": None, "ms": None} for fp in FINGERPRINTS}
        for c in best:
            c.fingerprints = await prove(c.host, dest=c.dest)
            _job.phase_done += 1
        _job.state = "done"
    except Exception as exc:  # noqa: BLE001 - reported to the panel, not raised
        _job.state, _job.error = "error", str(exc)[:300]
    finally:
        _job.finished_at = time.time()


# --- 1. discover -----------------------------------------------------------

def _cert_names(der: bytes) -> list[str]:
    cert = x509.load_der_x509_certificate(der)
    names: list[str] = []
    with suppress(x509.ExtensionNotFound):
        names += cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    for attr in cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME):
        names.append(str(attr.value))
    out = []
    for n in names:
        n = n.lower().strip(".")
        if n.startswith("*."):
            n = "www." + n[2:]
        if "." in n and n not in out and not n.replace(".", "").isdigit():
            out.append(n)
    return out


async def _peer_cert(ip: str) -> bytes | None:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    writer = None
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ip, 443, ssl=ctx), timeout=_DISCOVER_TIMEOUT)
        return writer.get_extra_info("ssl_object").getpeercert(binary_form=True)
    except Exception:  # noqa: BLE001 - silent neighbours are the norm
        return None
    finally:
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()


def ring_blocks(public_ip: str, ring: int) -> list[ipaddress.IPv4Network]:
    """Ring 0 is the node's own /24; ring k the two /24s k blocks either
    side of it — still the same provider's space almost always, so each
    "find more" walks outward instead of re-reading the same neighbours."""
    try:
        own = ipaddress.ip_network(f"{public_ip}/24", strict=False)
    except ValueError:
        return []
    if ring <= 0:
        return [own]
    out = []
    for step in (-ring, ring):
        start = int(own.network_address) + step * 256
        if 0 < start < 2**32 - 256:
            net = ipaddress.ip_network(f"{ipaddress.IPv4Address(start)}/24")
            if net.is_global:
                out.append(net)
    return out


async def _discover(public_ip: str, ring: int = 0, exclude: set[str] | None = None) -> None:
    ips = [str(ip) for net in ring_blocks(public_ip, ring) for ip in net.hosts() if str(ip) != public_ip]
    _job.phase_total, _job.phase_done = len(ips), 0
    sem = asyncio.Semaphore(_DISCOVER_CONCURRENCY)

    async def one(ip: str) -> None:
        async with sem:
            der = await _peer_cert(ip)
        _job.phase_done += 1
        if not der:
            return
        with suppress(Exception):
            for name in _cert_names(der)[:3]:
                if exclude and name in exclude:
                    continue
                _job.candidates.setdefault(name, Candidate(host=name, ip=ip, source="neighbor"))

    await asyncio.gather(*(one(ip) for ip in ips))


# --- 2. validate -----------------------------------------------------------

async def _resolves_to(host: str, ip: str) -> bool:
    """A neighbour only makes a good SNI when the name's own DNS points at the
    address it was found on: a censor can resolve the SNI and compare it with
    where the packets actually go, and a name that lives elsewhere (on a CDN,
    or nowhere, like an internal cert name) gets the connection throttled."""
    try:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, 443, family=socket.AF_INET, type=socket.SOCK_STREAM), timeout=5
        )
    except Exception:  # noqa: BLE001
        return False
    return ip in {i[4][0] for i in infos}


async def _validate_one(c: Candidate) -> None:
    if c.source == "neighbor" and c.ip and not await _resolves_to(c.host, c.ip):
        c.error = "the name's DNS points somewhere else"
        return
    ctx = ssl.create_default_context()
    ctx.set_alpn_protocols(["h2", "http/1.1"])
    writer = None
    target = c.ip if c.source == "neighbor" and c.ip else c.host
    start = time.monotonic()
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(target, 443, ssl=ctx, server_hostname=c.host), timeout=_VALIDATE_TIMEOUT
        )
        first_ms = round((time.monotonic() - start) * 1000)
        obj = writer.get_extra_info("ssl_object")
        c.tls, c.alpn = obj.version(), obj.selected_alpn_protocol()
        c.ip = c.ip or writer.get_extra_info("peername")[0]
        c.usable = c.tls == "TLSv1.3" and c.alpn == "h2"
        c.dest = f"{target}:443" if ":" not in target else f"[{target}]:443"
        if not c.usable:
            c.error = "needs TLS 1.3 and HTTP/2"
        # timed separately in _measure_all(), once the burst of validations
        # is over — timings taken during it are skewed by the load
        c.latency_ms = first_ms
    except ssl.SSLCertVerificationError:
        c.error = "certificate does not match the name"
    except Exception as exc:  # noqa: BLE001
        c.error = (str(exc) or exc.__class__.__name__)[:120]
    finally:
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()


async def _tcp_ms(ip: str) -> float | None:
    start = time.monotonic()
    try:
        _, w = await asyncio.wait_for(asyncio.open_connection(ip, 443), timeout=3)
    except Exception:  # noqa: BLE001
        return None
    ms = (time.monotonic() - start) * 1000
    w.close()
    with suppress(Exception):
        await w.wait_closed()
    return ms


async def _tls_ms(ip: str, host: str) -> float | None:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.set_alpn_protocols(["h2"])
    start = time.monotonic()
    try:
        _, w = await asyncio.wait_for(asyncio.open_connection(ip, 443, ssl=ctx, server_hostname=host), timeout=4)
    except Exception:  # noqa: BLE001
        return None
    ms = (time.monotonic() - start) * 1000
    w.close()
    with suppress(Exception):
        await w.wait_closed()
    return ms


def _median(xs: list[float]) -> int | None:
    xs = sorted(x for x in xs if x is not None)
    return round(xs[len(xs) // 2]) if xs else None


async def _measure_all(items: list[Candidate]) -> None:
    usable = [c for c in items if c.usable]
    _job.phase_total, _job.phase_done = len(usable), 0
    for c in usable:
        await _measure(c, c.ip or c.host)
        _job.phase_done += 1


async def _measure(c: Candidate, target: str) -> None:
    """Warm, repeated, by IP (no DNS in the timing): 5 TCP connects and 3
    TLS handshakes, one at a time, medians kept."""
    ip = c.ip or target
    await _tls_ms(ip, c.host)  # warm-up, not counted
    c.rtt_ms = _median([await _tcp_ms(ip) for _ in range(5)])
    c.latency_ms = _median([await _tls_ms(ip, c.host) for _ in range(3)])


async def _validate(items: list[Candidate]) -> None:
    _job.phase_total, _job.phase_done = len(items), 0
    sem = asyncio.Semaphore(24)

    async def one(c: Candidate) -> None:
        async with sem:
            await _validate_one(c)
        _job.phase_done += 1

    await asyncio.gather(*(one(c) for c in items))


# --- 3. prove --------------------------------------------------------------

def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _keypair() -> tuple[str, str]:
    key = X25519PrivateKey.generate()
    priv = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return _b64(priv), _b64(pub)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _wait_port(port: int, timeout: float = 5.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        with suppress(OSError):
            _, w = await asyncio.open_connection("127.0.0.1", port)
            w.close()
            return True
        await asyncio.sleep(0.1)
    return False


async def _once(socks_port: int) -> float | None:
    proc = await asyncio.create_subprocess_exec(
        "curl", "-s", "-o", "/dev/null", "-w", "%{http_code} %{time_total}", "-m", str(_FETCH_TIMEOUT),
        "--socks5-hostname", f"127.0.0.1:{socks_port}", PROBE_URL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    parts = out.decode().split()
    if len(parts) == 2 and parts[0] == "204":
        return float(parts[1]) * 1000
    return None


async def _fetch_via(socks_port: int) -> tuple[bool, int | None]:
    """Three timed requests after the warm-up in prove(). A fingerprint
    works if at least two load the page; its time is their median, the
    round trip a user would actually see."""
    times = [t for t in [await _once(socks_port) for _ in range(3)] if t is not None]
    if len(times) < 2:
        return False, None
    times.sort()
    return True, round(times[len(times) // 2])


async def prove(host: str, fingerprints: list[str] | None = None, dest: str | None = None) -> dict[str, dict]:
    """Starts a throwaway REALITY server that borrows `host`, connects to it
    once per fingerprint through a real Xray client, and reports which
    fingerprints got a page back. Both processes only listen on 127.0.0.1."""
    fps = fingerprints or FINGERPRINTS
    priv, pub = _keypair()
    uid, sid = str(uuid.uuid4()), "%08x" % random.getrandbits(32)
    srv_port = _free_port()
    ports = {fp: _free_port() for fp in fps}
    server = {
        "log": {"loglevel": "none"},
        "inbounds": [{
            "listen": "127.0.0.1", "port": srv_port, "protocol": "vless",
            "settings": {"clients": [{"id": uid, "flow": "xtls-rprx-vision"}], "decryption": "none"},
            "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {
                "dest": dest or f"{host}:443", "serverNames": [host], "privateKey": priv, "shortIds": [sid]}},
        }],
        "outbounds": [{"protocol": "freedom", "settings": {"domainStrategy": "UseIPv4"}}],
    }
    client = {
        "log": {"loglevel": "none"},
        "inbounds": [{"tag": f"in-{fp}", "listen": "127.0.0.1", "port": p, "protocol": "socks", "settings": {"udp": False}} for fp, p in ports.items()],
        "outbounds": [{
            "tag": f"out-{fp}", "protocol": "vless",
            "settings": {"vnext": [{"address": "127.0.0.1", "port": srv_port, "users": [{"id": uid, "encryption": "none", "flow": "xtls-rprx-vision"}]}]},
            "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {
                "serverName": host, "fingerprint": fp, "publicKey": pub, "shortId": sid}},
        } for fp in fps],
        "routing": {"rules": [{"type": "field", "inboundTag": [f"in-{fp}"], "outboundTag": f"out-{fp}"} for fp in fps]},
    }
    procs = []
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for name, cfg in (("server.json", server), ("client.json", client)):
            path = os.path.join(tmp, name)
            with open(path, "w") as f:
                json.dump(cfg, f)
            paths.append(path)
        try:
            for path in paths:
                procs.append(await asyncio.create_subprocess_exec(
                    XRAY_BIN, "run", "-c", path, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL))
            if not await _wait_port(srv_port) or not await _wait_port(next(iter(ports.values()))):
                return {fp: {"ok": False, "ms": None} for fp in fps}
            # The first connection through a freshly started Xray pair stalls
            # for about five seconds while nothing on the wire is slow, so
            # every fingerprint is warmed up (together) and never timed on it.
            # The timed runs go one fingerprint at a time so they don't skew
            # each other.
            await asyncio.gather(*(_once(p) for p in ports.values()))
            results = [await _fetch_via(p) for p in ports.values()]
            return {fp: {"ok": ok, "ms": ms if ok else None} for fp, (ok, ms) in zip(ports, results)}
        finally:
            for p in procs:
                with suppress(ProcessLookupError):
                    p.terminate()
            for p in procs:
                with suppress(Exception):
                    await asyncio.wait_for(p.wait(), timeout=3)



