import asyncio
import ssl
import time
from dataclasses import dataclass

DEFAULT_PORT = 443
DEFAULT_TIMEOUT = 5.0
DEFAULT_CONCURRENCY = 40


@dataclass
class ScanResult:
    host: str
    reachable: bool
    tls_version: str | None
    alpn: str | None
    latency_ms: float | None
    error: str | None


async def _scan_one(host: str, port: int, timeout: float) -> ScanResult:
    ctx = ssl.create_default_context()
    ctx.set_alpn_protocols(["h2", "http/1.1"])

    start = time.monotonic()
    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ctx, server_hostname=host),
            timeout=timeout,
        )
        latency_ms = (time.monotonic() - start) * 1000
        ssl_object = writer.get_extra_info("ssl_object")
        return ScanResult(
            host=host,
            reachable=True,
            tls_version=ssl_object.version() if ssl_object else None,
            alpn=ssl_object.selected_alpn_protocol() if ssl_object else None,
            latency_ms=round(latency_ms, 1),
            error=None,
        )
    except Exception as exc:  # noqa: BLE001 - any failure just means "not usable as a target"
        return ScanResult(host=host, reachable=False, tls_version=None, alpn=None, latency_ms=None, error=str(exc))
    finally:
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001 - best-effort cleanup
                pass


async def scan_targets(
    hosts: list[str],
    port: int = DEFAULT_PORT,
    timeout: float = DEFAULT_TIMEOUT,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> list[ScanResult]:
    semaphore = asyncio.Semaphore(concurrency)

    async def bound_scan(host: str) -> ScanResult:
        async with semaphore:
            return await _scan_one(host, port, timeout)

    return list(await asyncio.gather(*(bound_scan(h) for h in hosts)))


def is_reality_ready(result: ScanResult) -> bool:
    """REALITY needs a TLS 1.3 server; without it the handshake it forges won't match."""
    return result.reachable and result.tls_version == "TLSv1.3"
