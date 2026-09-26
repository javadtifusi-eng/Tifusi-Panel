"""Candidate domestic source addresses for spoof auto-discovery.

The hardest part of a spoofing tunnel for an operator to get right is picking
a forged source IP that Iran's national-internet filter keeps on its
allow-list — traffic *from* a domestic network it treats as internal. Rather
than expect the admin to know one, the panel can probe a curated set of
well-known domestic networks and keep whichever actually arrive at the other
end (see build_discovery_command / parse_arrived_sources).

Each entry is one representative address of a major domestic network
(operators, banks, public services) that tends to stay reachable when the
international link is cut. The list is a starting point the admin can extend;
nothing here sends traffic by itself — it only fills the probe's target list.
"""

import ipaddress
import re

# name → one representative IPv4 of a domestic network. Kept to single
# addresses (not whole ranges) so a discovery run stays a light probe: once a
# network's representative passes, its wider range is worth trying for the
# real pool.
CANDIDATE_SOURCES: dict[str, str] = {
    "TCI (Telecommunication Co. of Iran)": "2.144.0.1",
    "MCI / Hamrah-e Aval": "5.112.0.1",
    "Irancell": "5.160.0.1",
    "Rightel": "37.98.0.1",
    "Shatel": "85.15.0.1",
    "Pars Online": "91.98.0.1",
    "AsiaTech": "78.157.32.1",
    "Respina": "83.123.0.1",
    "Mobinnet": "31.14.0.1",
    "Bank Melli": "217.218.0.1",
    "Bank Mellat": "185.73.0.1",
    "Central Bank (Shaparak)": "217.66.192.1",
    "Sepah Bank": "185.101.0.1",
    "Iran Gov (dolat.ir range)": "80.191.0.1",
    "Sharif University": "81.31.160.1",
    "Tehran University": "194.225.0.1",
    "IRIB": "185.44.0.1",
    "Fanava": "188.209.0.1",
    "Datak": "82.99.192.1",
    "Afranet": "217.11.16.1",
}


def build_discovery_spec() -> str:
    """The comma-separated forged-source list a discovery probe sweeps: every
    candidate representative address at once. Small enough (well under the
    sender's cap) to send in one short run."""
    return ",".join(CANDIDATE_SOURCES.values())


def is_candidate(ip: str) -> bool:
    return ip in set(CANDIDATE_SOURCES.values())


def label_for(ip: str) -> str | None:
    for name, addr in CANDIDATE_SOURCES.items():
        if addr == ip:
            return name
    return None


_ARRIVED = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+\(\d+\s+packets?\)", re.MULTILINE)


def parse_arrived_sources(receiver_output: str) -> list[str]:
    """Pulls the addresses that actually arrived out of a discovery receiver's
    output (lines like `  2.144.0.1  (3 packets)`), de-duplicated and only
    keeping syntactically valid IPv4 — so pasted noise can't inject anything.
    """
    out: list[str] = []
    seen: set[str] = set()
    for m in _ARRIVED.finditer(receiver_output or ""):
        ip = m.group(1)
        if ip in seen:
            continue
        try:
            ipaddress.IPv4Address(ip)
        except ValueError:
            continue
        seen.add(ip)
        out.append(ip)
    return out
