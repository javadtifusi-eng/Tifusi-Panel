"""Real measurements of a tunnel's CDN path: clean edge IPs, domain
fronting and throughput.

Standard library only: the same file runs inside the panel and, copied in
by node_agent/Dockerfile, on a node, so the checks can be made from the
tunnel's foreign server — the machine that actually dials the CDN.

Everything here talks to the relay the way the foreign side of the tunnel
does (TLS to an edge, a WebSocket upgrade on the tunnel's path), so a pass
means the CDN really carried a connection through to the relay.
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import os
import ssl
import statistics
import struct
import time
import urllib.request

RANGE_URLS = {
    "arvan": "https://www.arvancloud.ir/en/ips.txt",
    "cloudflare": "https://www.cloudflare.com/ips-v4",
}
# Used when the provider's list can't be fetched (it is itself behind the CDN).
FALLBACK_RANGES = {
    "arvan": [
        "185.143.232.0/22", "188.229.116.16/30", "94.101.182.0/27", "2.144.3.128/28",
        "37.32.16.0/27", "37.32.17.0/27", "37.32.18.0/27", "37.32.19.0/27",
        "185.215.232.0/22", "178.131.120.48/28", "94.101.183.0/28", "78.157.36.112/28",
        "95.38.61.80/28", "193.24.119.0/29",
    ],
    "cloudflare": [
        "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
        "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
        "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
        "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    ],
}

# Well-known Iranian sites. Which of them really sit on the CDN is decided by
# resolving them at scan time, and only those that then carry a WebSocket
# through to the relay are offered.
IRAN_SITES = [
    "snapp.ir", "snappfood.ir", "tapsi.ir", "divar.ir", "digikala.com", "digistyle.com", "basalam.com",
    "torob.com", "emalls.ir", "technolife.ir", "alibaba.ir", "cafebazaar.ir", "myket.ir", "sheypoor.com",
    "aparat.com", "filimo.com", "namava.ir", "varzesh3.com", "isna.ir", "irna.ir", "tasnimnews.com",
    "farsnews.ir", "mehrnews.com", "yjc.ir", "khabaronline.ir", "hamshahrionline.ir", "eghtesadnews.com",
    "tgju.org", "bmi.ir", "sb24.ir", "bankmellat.ir", "shaparak.ir", "jobinja.ir", "quera.org",
    "maktabkhooneh.org", "faradars.org", "ninisite.com", "zoomit.ir", "digiato.com", "virgool.io",
    "namnak.com", "bartarinha.ir", "tebyan.net", "p30download.ir", "soft98.ir", "snapp.market",
    "arvancloud.ir", "tamin.ir",
]

_range_cache: dict[str, tuple[float, list[ipaddress.IPv4Network]]] = {}
_RANGE_TTL = 6 * 3600


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 - fixed https URLs
        return r.read(65536).decode(errors="replace")


async def cdn_ranges(provider: str) -> list[ipaddress.IPv4Network]:
    cached = _range_cache.get(provider)
    if cached and time.time() - cached[0] < _RANGE_TTL:
        return cached[1]
    lines: list[str] = []
    try:
        lines = (await asyncio.to_thread(_fetch, RANGE_URLS[provider])).split()
    except Exception:  # noqa: BLE001
        pass
    nets = []
    for line in lines:
        try:
            net = ipaddress.ip_network(line.strip(), strict=False)
        except ValueError:
            continue
        if net.version == 4:
            nets.append(net)
    if not nets:
        nets = [ipaddress.ip_network(n) for n in FALLBACK_RANGES[provider]]
    _range_cache[provider] = (time.time(), nets)
    return nets


def sample_ips(nets: list[ipaddress.IPv4Network], limit: int) -> list[str]:
    """Spreads `limit` addresses across the ranges, in proportion to their
    size but at least two from each, evenly spaced inside every range."""
    usable = [n for n in nets if n.num_addresses >= 4]
    if not usable:
        return []
    total = sum(n.num_addresses for n in usable)
    out: list[str] = []
    for n in usable:
        want = max(2, round(limit * n.num_addresses / total))
        hosts = n.num_addresses - 2
        step = max(1, hosts // want)
        for i in range(min(want, hosts)):
            out.append(str(n.network_address + 1 + i * step))
    return out[: max(limit, 2 * len(usable))]


def _ws_request(host: str, path: str) -> bytes:
    key = base64.b64encode(os.urandom(16)).decode()
    return (
        f"GET {path or '/'} HTTP/1.1\r\nHost: {host}\r\n"
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n"
        "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n"
        f"Sec-WebSocket-Key: {key}\r\n\r\n"
    ).encode()


def _ctx() -> ssl.SSLContext:
    # The foreign side doesn't verify either: with a front SNI the edge
    # presents the front site's certificate, not ours.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def ws_open(addr: str, port: int, sni: str, host: str, path: str, timeout: float = 6.0):
    """TLS to `addr` with `sni`, WebSocket upgrade for `host` + `path`.
    Returns (reader, writer, ms) on a 101, raises with a short reason otherwise."""
    start = time.monotonic()
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(addr, port, ssl=_ctx(), server_hostname=sni), timeout=timeout
    )
    try:
        writer.write(_ws_request(host, path))
        await writer.drain()
        status = (await asyncio.wait_for(reader.readline(), timeout=timeout)).decode(errors="replace").strip()
        if " 101 " not in f"{status} ":
            raise ConnectionError(status[9:60] if status.startswith("HTTP/") else (status[:50] or "no answer"))
        while (await asyncio.wait_for(reader.readline(), timeout=timeout)) not in (b"\r\n", b"\n", b""):
            pass
        return reader, writer, round((time.monotonic() - start) * 1000)
    except BaseException:
        writer.close()
        raise


async def _close(writer) -> None:
    writer.close()
    try:
        await asyncio.wait_for(writer.wait_closed(), 2)
    except Exception:  # noqa: BLE001
        pass


async def handshake(addr: str, port: int, sni: str, host: str, path: str, timeout: float = 6.0):
    try:
        _, writer, ms = await ws_open(addr, port, sni, host, path, timeout)
        await _close(writer)
        return True, ms, None
    except asyncio.TimeoutError:
        return False, None, "timeout"
    except ssl.SSLError as exc:
        return False, None, f"TLS: {exc.reason or 'failed'}"
    except OSError as exc:
        return False, None, str(exc)[:60] or exc.__class__.__name__


async def scan_edges(provider: str, host: str, path: str, port: int, sni: str | None = None,
                     limit: int = 128, keep: int = 10, concurrency: int = 32) -> dict:
    nets = await cdn_ranges(provider)
    ips = sample_ips(nets, limit)
    sem = asyncio.Semaphore(concurrency)

    async def first(ip: str):
        async with sem:
            ok, ms, _ = await handshake(ip, port, sni or host, host, path, timeout=4.0)
            return ip, ok, ms

    answered = [(ip, ms) for ip, ok, ms in await asyncio.gather(*(first(ip) for ip in ips)) if ok]
    answered.sort(key=lambda x: x[1])
    finalists = [ip for ip, _ in answered[:keep]]

    async def settle(ip: str) -> dict:
        times = []
        for _ in range(3):
            ok, ms, _ = await handshake(ip, port, sni or host, host, path, timeout=5.0)
            if ok:
                times.append(ms)
        return {
            "ip": ip,
            "ms": round(statistics.median(times)) if times else None,
            "jitter": round((max(times) - min(times)) / 2) if len(times) > 1 else None,
            "ok": len(times),
            "tries": 3,
        }

    edges = await asyncio.gather(*(settle(ip) for ip in finalists))
    edges.sort(key=lambda e: (-e["ok"], e["ms"] if e["ms"] is not None else 1e9))
    return {"ranges": len(nets), "tested": len(ips), "answered": len(answered), "edges": edges}


async def _resolve(name: str) -> list[str]:
    try:
        infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(name, 443, family=2), 5)
        return sorted({i[4][0] for i in infos})
    except Exception:  # noqa: BLE001
        return []


async def scan_fronts(provider: str, host: str, path: str, port: int, edge: str | None = None) -> dict:
    """Finds sites on the same CDN and checks, for each, whether the edge
    carries our WebSocket when the TLS name is that site's (domain
    fronting). `edge` is the address the tunnel dials; by default the one
    the CDN name itself resolves to."""
    nets = await cdn_ranges(provider)

    def on_cdn(ips: list[str]) -> bool:
        return any(ipaddress.ip_address(ip) in n for ip in ips for n in nets)

    target = edge or next(iter(await _resolve(host)), None)
    resolved = await asyncio.gather(*(_resolve(d) for d in IRAN_SITES))
    candidates = [d for d, ips in zip(IRAN_SITES, resolved) if ips and on_cdn(ips)]
    if not target:
        return {"checked": len(IRAN_SITES), "on_cdn": len(candidates), "fronts": [], "error": f"{host} does not resolve"}

    async def test(domain: str) -> dict:
        ok, ms, err = await handshake(target, port, domain, host, path, timeout=6.0)
        return {"domain": domain, "works": ok, "ms": ms, "error": err}

    fronts = await asyncio.gather(*(test(d) for d in candidates))
    fronts.sort(key=lambda f: (not f["works"], f["ms"] or 1e9))
    return {"checked": len(IRAN_SITES), "on_cdn": len(candidates), "fronts": fronts, "edge": target}


def _frame(payload: bytes) -> bytes:
    """One masked binary frame, as a WebSocket client must send."""
    mask = os.urandom(4)
    n = len(payload)
    head = bytes([0x82])
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    return head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


async def _read_frame(reader) -> tuple[int, bytes]:
    b0, b1 = await reader.readexactly(2)
    n = b1 & 0x7F
    if n == 126:
        n = struct.unpack(">H", await reader.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if b1 & 0x80 else None
    data = await reader.readexactly(n)
    if mask:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return b0 & 0x0F, data


async def speed_test(addr: str, port: int, sni: str, host: str, path: str, token: str,
                     nbytes: int = 8 << 20, timeout: float = 60.0) -> dict:
    """Downloads `nbytes` from the relay through the CDN over the tunnel's own
    protocol (hello role "speed"), so the number is what the tunnel gets."""
    via = f"{addr} · SNI {sni}"
    try:
        reader, writer, ping = await ws_open(addr, port, sni, host, path, timeout=10.0)
    except Exception as exc:  # noqa: BLE001
        reason = "timeout" if isinstance(exc, asyncio.TimeoutError) else (str(exc)[:60] or exc.__class__.__name__)
        return {"ok": False, "mbps": None, "ping_ms": None, "bytes": 0, "seconds": None, "via": via,
                "error": f"no WebSocket through the CDN: {reason}"}
    got = 0
    buf = b""
    replied = False
    start = time.monotonic()
    error = None
    try:
        hello = json.dumps({"ver": "panel", "token": token, "role": "speed", "bytes": nbytes}).encode() + b"\n"
        writer.write(_frame(hello))
        await writer.drain()
        deadline = start + timeout
        while got < nbytes:
            left = deadline - time.monotonic()
            if left <= 0:
                error = "timed out"
                break
            op, data = await asyncio.wait_for(_read_frame(reader), left)
            if op == 0x8:
                break
            if op not in (0x0, 0x1, 0x2):
                continue
            if not replied:
                buf += data
                if b"\n" not in buf:
                    continue
                line, rest = buf.split(b"\n", 1)
                rep = json.loads(line or b"{}")
                if not rep.get("ok"):
                    error = f"relay refused: {rep.get('err') or 'handshake'}"
                    break
                replied = True
                start = time.monotonic()
                got += len(rest)
            else:
                got += len(data)
    except asyncio.IncompleteReadError:
        pass
    except Exception as exc:  # noqa: BLE001
        error = str(exc)[:60] or exc.__class__.__name__
    finally:
        await _close(writer)
    secs = time.monotonic() - start
    if replied and got == 0 and not error:
        error = "the relay's tunnel program is too old for a speed test — re-run the install command on the Iran server"
    if error and got < nbytes // 4:
        return {"ok": False, "mbps": None, "ping_ms": ping, "bytes": got, "seconds": None, "via": via, "error": error}
    return {
        "ok": True,
        "mbps": round(got * 8 / max(secs, 1e-3) / 1e6, 1),
        "ping_ms": ping,
        "bytes": got,
        "seconds": round(secs, 1),
        "via": via,
        "error": None,
    }
