import ipaddress

import httpx

# A module attribute rather than a constant, so a test can point it at a
# local stub server, same as TELEGRAM_API_BASE.
CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"

# The shortest TTL Cloudflare allows on a non-enterprise zone: resolvers
# drop the old relay's address within a minute of a switch.
_TTL_SECONDS = 60


class CloudflareError(Exception):
    pass


def record_type_for(address: str) -> str:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return "CNAME"
    return "A" if ip.version == 4 else "AAAA"


async def _call(client: httpx.AsyncClient, method: str, path: str, **kwargs) -> dict:
    try:
        resp = await client.request(method, f"{CLOUDFLARE_API_BASE}{path}", **kwargs)
    except httpx.HTTPError as exc:
        raise CloudflareError(f"Cloudflare unreachable: {exc.__class__.__name__}") from exc
    try:
        body = resp.json()
    except ValueError as exc:
        raise CloudflareError(f"Cloudflare returned HTTP {resp.status_code}") from exc
    if not body.get("success"):
        errors = body.get("errors") or []
        message = "; ".join(str(e.get("message")) for e in errors if isinstance(e, dict)) or f"HTTP {resp.status_code}"
        raise CloudflareError(f"Cloudflare: {message}")
    return body


async def find_zone_id(token: str, record: str) -> str:
    """Walks up the record's name (a.b.example.com, b.example.com,
    example.com) until Cloudflare knows one of them as a zone."""
    labels = record.rstrip(".").split(".")
    async with httpx.AsyncClient(timeout=10.0, headers={"Authorization": f"Bearer {token}"}) as client:
        for i in range(len(labels) - 1):
            body = await _call(client, "GET", "/zones", params={"name": ".".join(labels[i:])})
            if body.get("result"):
                return body["result"][0]["id"]
    raise CloudflareError(f"Cloudflare: no zone found for {record} with this token")


async def point_record(token: str, zone_id: str, record: str, address: str) -> None:
    """Makes `record` resolve to `address`, keeping the record's own
    proxied flag. A record of a different type (A → CNAME when a relay is
    given by hostname) can't be edited into the other type, so it is
    replaced."""
    rtype = record_type_for(address)
    async with httpx.AsyncClient(timeout=10.0, headers={"Authorization": f"Bearer {token}"}) as client:
        body = await _call(client, "GET", f"/zones/{zone_id}/dns_records", params={"name": record})
        existing = [r for r in body.get("result") or [] if r.get("type") in ("A", "AAAA", "CNAME")]
        same_type = [r for r in existing if r.get("type") == rtype]
        if same_type:
            keep, *extra = same_type
            if keep.get("content") != address:
                await _call(client, "PATCH", f"/zones/{zone_id}/dns_records/{keep['id']}", json={"content": address})
            # Round-robin leftovers would keep sending some clients to the dead relay.
            for r in extra + [r for r in existing if r.get("type") != rtype]:
                await _call(client, "DELETE", f"/zones/{zone_id}/dns_records/{r['id']}")
            return
        # Cloudflare refuses a CNAME next to an A/AAAA of the same name, so
        # the old records go first.
        for r in existing:
            await _call(client, "DELETE", f"/zones/{zone_id}/dns_records/{r['id']}")
        await _call(
            client,
            "POST",
            f"/zones/{zone_id}/dns_records",
            json={"type": rtype, "name": record, "content": address, "ttl": _TTL_SECONDS, "proxied": False},
        )
