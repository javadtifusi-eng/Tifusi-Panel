"""REALITY target scanner, run on the node itself.

A REALITY dest has to work *from the node*: the node is the one that
forwards unauthenticated handshakes to it, so latency and reachability are
measured here, not on the panel. The scan has three steps:

1. discover: TLS-connect to every address in the node's own /24 and read
   the names off each certificate — neighbours in the same datacenter are
   the targets Xray's authors recommend, and they are found live rather
   than picked from a fixed list;
2. validate: connect to each name with SNI and a verified certificate,
   keeping those that speak TLS 1.3 and HTTP/2;
3. prove: for the best candidates, start a real REALITY server and client
   on this node and fetch a page through it once per uTLS fingerprint. A
   fingerprint is marked working only if that page actually loaded.
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
    source: str = "list"
    tls: str | None = None
    alpn: str | None = None
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
    state: str = "idle"  # idle | discovering | validating | testing | done | error
    phase_total: int = 0
    phase_done: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None
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
            "results": [asdict(c) for c in items],
        }


def _rank(c: Candidate) -> tuple:
    fps = c.fingerprints or {}
    working = sum(1 for r in fps.values() if r.get("ok"))
    return (not c.usable, -int(bool(fps.get("chrome", {}).get("ok"))), -working, c.latency_ms or 10**6)


_job = Job()
_task: asyncio.Task | None = None


def status() -> dict:
    return _job.snapshot()


def running() -> bool:
    return _task is not None and not _task.done()


def start(public_ip: str | None, hosts: list[str], neighbors: bool, test_top: int) -> None:
    global _job, _task
    _job = Job(state="discovering", started_at=time.time())
    _task = asyncio.get_running_loop().create_task(_run(public_ip, hosts, neighbors, test_top))


async def _run(public_ip: str | None, hosts: list[str], neighbors: bool, test_top: int) -> None:
    try:
        for h in hosts:
            _job.candidates.setdefault(h, Candidate(host=h, source="custom" if len(hosts) <= 3 else "list"))
        if neighbors and public_ip:
            await _discover(public_ip)
        _job.state = "validating"
        await _validate(list(_job.candidates.values()))
        _job.state = "testing"
        best = sorted((c for c in _job.candidates.values() if c.usable), key=lambda c: c.latency_ms or 10**6)[:test_top]
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


async def _discover(public_ip: str) -> None:
    try:
        net = ipaddress.ip_network(f"{public_ip}/24", strict=False)
    except ValueError:
        return
    ips = [str(ip) for ip in net.hosts() if str(ip) != public_ip]
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
                _job.candidates.setdefault(name, Candidate(host=name, ip=ip, source="neighbor"))

    await asyncio.gather(*(one(ip) for ip in ips))


# --- 2. validate -----------------------------------------------------------

async def _validate_one(c: Candidate) -> None:
    ctx = ssl.create_default_context()
    ctx.set_alpn_protocols(["h2", "http/1.1"])
    writer = None
    target = c.ip if c.source == "neighbor" and c.ip else c.host
    start = time.monotonic()
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(target, 443, ssl=ctx, server_hostname=c.host), timeout=_VALIDATE_TIMEOUT
        )
        c.latency_ms = round((time.monotonic() - start) * 1000)
        obj = writer.get_extra_info("ssl_object")
        c.tls, c.alpn = obj.version(), obj.selected_alpn_protocol()
        c.ip = c.ip or writer.get_extra_info("peername")[0]
        c.usable = c.tls == "TLSv1.3" and c.alpn == "h2"
        c.dest = f"{target}:443" if ":" not in target else f"[{target}]:443"
        if not c.usable:
            c.error = "needs TLS 1.3 and HTTP/2"
    except ssl.SSLCertVerificationError:
        c.error = "certificate does not match the name"
    except Exception as exc:  # noqa: BLE001
        c.error = (str(exc) or exc.__class__.__name__)[:120]
    finally:
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()


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


async def _fetch_via(socks_port: int) -> tuple[bool, int]:
    start = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", str(_FETCH_TIMEOUT),
        "--socks5-hostname", f"127.0.0.1:{socks_port}", PROBE_URL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    return out.decode().strip() == "204", round((time.monotonic() - start) * 1000)


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
            results = await asyncio.gather(*(_fetch_via(p) for p in ports.values()))
            return {fp: {"ok": ok, "ms": ms if ok else None} for fp, (ok, ms) in zip(ports, results)}
        finally:
            for p in procs:
                with suppress(ProcessLookupError):
                    p.terminate()
            for p in procs:
                with suppress(Exception):
                    await asyncio.wait_for(p.wait(), timeout=3)


async def check_single(host: str) -> dict:
    """Validation plus the real test for one name the admin typed in."""
    c = Candidate(host=host.lower().strip().strip("."), source="custom")
    await _validate_one(c)
    if c.usable:
        c.fingerprints = await prove(c.host, dest=c.dest)
    return asdict(c)
