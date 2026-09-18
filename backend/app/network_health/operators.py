"""Which Iranian operator a report came from.

The IP ranges each operator announces are fetched from RIPEstat once a day
and matched locally — users' addresses never leave the panel. When the IP
doesn't match (the report was sent through the VPN itself, or from an
operator not listed here), the SIM carrier the app reports is used, but
only on mobile data: on Wi-Fi the SIM says nothing about the network.
"""

import asyncio
import ipaddress
import json
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

RIPESTAT_URL = "https://stat.ripe.net/data/announced-prefixes/data.json"
_DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "operator_prefixes.json"
_MAX_AGE_SECONDS = 24 * 3600

UNKNOWN = "unknown"


@dataclass(frozen=True)
class Operator:
    key: str
    name_fa: str
    name_en: str
    asns: tuple[int, ...]
    # Lowercased, spaces/dashes removed; matched as substrings of the
    # carrier name Android reports ("IR-MCI", "MTN Irancell", "RighTel"…).
    carrier_aliases: tuple[str, ...] = ()


OPERATORS: tuple[Operator, ...] = (
    Operator("mci", "همراه اول", "MCI", (197207,), ("mci", "hamrah", "همراه")),
    Operator("irancell", "ایرانسل", "Irancell", (44244,), ("irancell", "mtn", "ایرانسل")),
    Operator("rightel", "رایتل", "RighTel", (57218,), ("rightel", "رایتل")),
    Operator("tci", "مخابرات", "TCI", (58224,)),
    Operator("shatel", "شاتل", "Shatel", (31549,)),
    Operator("parsonline", "پارس‌آنلاین", "ParsOnline", (16322,)),
    Operator("asiatech", "آسیاتک", "Asiatech", (43343,)),
    Operator("mobinnet", "مبین‌نت", "Mobinnet", (50810,)),
)
BY_KEY = {o.key: o for o in OPERATORS}

# First octet -> [(first address, last address, operator key)] for IPv4;
# a flat list for IPv6, which has far fewer announced prefixes here.
_v4: dict[int, list[tuple[int, int, str]]] = {}
_v6: list[tuple[int, int, str]] = []
_loaded = False
_lock = asyncio.Lock()


def _build_index(data: dict[str, list[str]]) -> None:
    global _v4, _v6, _loaded
    v4: dict[int, list[tuple[int, int, str]]] = {}
    v6: list[tuple[int, int, str]] = []
    for key, prefixes in data.items():
        for prefix in prefixes:
            try:
                net = ipaddress.ip_network(prefix, strict=False)
            except ValueError:
                continue
            lo, hi = int(net.network_address), int(net.broadcast_address)
            if net.version == 4:
                for octet in range(lo >> 24, (hi >> 24) + 1):
                    v4.setdefault(octet, []).append((lo, hi, key))
            else:
                v6.append((lo, hi, key))
    _v4, _v6, _loaded = v4, v6, True


def _load_file() -> dict[str, list[str]] | None:
    try:
        return json.loads(_DATA_FILE.read_text())["operators"]
    except (OSError, ValueError, KeyError):
        return None


async def _fetch(client: httpx.AsyncClient, asn: int) -> list[str]:
    resp = await client.get(RIPESTAT_URL, params={"resource": f"AS{asn}"})
    resp.raise_for_status()
    return [p["prefix"] for p in resp.json()["data"]["prefixes"]]


async def refresh_prefixes() -> None:
    """Re-downloads the prefix lists when the saved copy is over a day old.
    A failed download keeps the previous copy; one operator failing keeps
    that operator's previous prefixes."""
    async with _lock:
        try:
            fresh = time.time() - _DATA_FILE.stat().st_mtime < _MAX_AGE_SECONDS
        except OSError:
            fresh = False
        saved = _load_file() or {}
        if fresh and saved:
            if not _loaded:
                _build_index(saved)
            return

        data: dict[str, list[str]] = {}
        async with httpx.AsyncClient(timeout=20.0) as client:
            for op in OPERATORS:
                prefixes: list[str] = []
                try:
                    for asn in op.asns:
                        prefixes += await _fetch(client, asn)
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    prefixes = saved.get(op.key, [])
                data[op.key] = prefixes

        if any(data.values()):
            try:
                _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
                _DATA_FILE.write_text(json.dumps({"updated_at": int(time.time()), "operators": data}))
            except OSError:
                pass
            _build_index(data)
        elif saved and not _loaded:
            _build_index(saved)


def _ensure_loaded() -> None:
    if not _loaded:
        _build_index(_load_file() or {})


def operator_for_ip(address: str | None) -> str | None:
    if not address:
        return None
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return None
    _ensure_loaded()
    value = int(ip)
    candidates = _v4.get(value >> 24, []) if ip.version == 4 else _v6
    for lo, hi, key in candidates:
        if lo <= value <= hi:
            return key
    return None


def _normalize(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch not in " -_.")


def operator_for_carrier(*names: str | None) -> str | None:
    for name in names:
        if not name:
            continue
        norm = _normalize(name)
        for op in OPERATORS:
            if any(alias in norm for alias in op.carrier_aliases):
                return op.key
    return None


def classify(client_ip: str | None, network: str | None, carrier: str | None, sim_carrier: str | None) -> str:
    by_ip = operator_for_ip(client_ip)
    if by_ip:
        return by_ip
    net = (network or "").lower()
    if net in ("", "mobile", "cellular"):
        by_name = operator_for_carrier(carrier, sim_carrier)
        if by_name:
            return by_name
    return UNKNOWN
