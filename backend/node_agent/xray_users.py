"""Applies a pushed Xray config without restarting Xray when only users changed.

The panel pushes the whole config on every user change (created, renewed,
expired, deleted). Restarting Xray for that drops every connected user for a
moment, which with many users means everyone gets cut off many times a day.
When the new config differs from the running one only in the clients of
tagged VLESS/VMess/Trojan inbounds, the difference is applied through Xray's
HandlerService instead (`xray api rmu` / `xray api adu`), and nobody else
notices anything.

Anything else that changed — an inbound, a port, routing, an outbound, a
client without an email, a protocol not listed here — returns None from
user_diff(), and the caller restarts Xray exactly as before. A failed API
call does the same, since the restart reloads the full config from disk and
so repairs whatever half of the change did or didn't land.
"""

import json
import logging
import os
import re
import subprocess
import tempfile
from copy import deepcopy
from dataclasses import dataclass, field

log = logging.getLogger("tifusi.xray_users")

# Protocols whose users AlterInbound adds and removes by email. Shadowsocks is
# left out on purpose: its 2022 ciphers key users differently, and getting
# that wrong would lock people out, so a Shadowsocks change still restarts.
HOT_PROTOCOLS = ("vless", "vmess", "trojan")


@dataclass
class UserDiff:
    # inbound tag -> the new config's whole inbound, holding only the clients to
    # add: `xray api adu` builds the inbound before reading its users, and one
    # that doesn't build (no port, a VLESS one without "decryption") adds none.
    adds: dict[str, dict] = field(default_factory=dict)
    # inbound tag -> emails to remove
    removes: dict[str, list[str]] = field(default_factory=dict)

    def empty(self) -> bool:
        return not self.adds and not self.removes

    def revoked(self) -> set[str]:
        """Emails that lost access: removed from an inbound and not re-added to
        any. A renewed or edited user is removed and added back, so is not one."""
        added = self.restored()
        return {e for emails in self.removes.values() for e in emails} - added

    def restored(self) -> set[str]:
        return {c["email"] for inbound in self.adds.values() for c in _clients(inbound) or []}


def _clients(inbound: dict) -> list[dict] | None:
    settings = inbound.get("settings")
    if not isinstance(settings, dict):
        return None
    clients = settings.get("clients")
    return clients if isinstance(clients, list) else None


def _without_clients(config: dict) -> dict:
    stripped = deepcopy(config)
    for inbound in stripped.get("inbounds") or []:
        if isinstance(inbound, dict) and _clients(inbound) is not None:
            inbound["settings"]["clients"] = []
    return stripped


def user_diff(old: dict, new: dict) -> UserDiff | None:
    """What to add and remove to turn the running config into the new one, or
    None when that cannot be done through the API alone."""
    if json.dumps(_without_clients(old), sort_keys=True) != json.dumps(_without_clients(new), sort_keys=True):
        return None

    diff = UserDiff()
    # Identical apart from clients, so the inbound lists line up one to one.
    for before, after in zip(old.get("inbounds") or [], new.get("inbounds") or []):
        old_clients = _clients(before) or []
        new_clients = _clients(after) or []
        if old_clients == new_clients:
            continue
        tag, protocol = after.get("tag"), after.get("protocol")
        if not tag or protocol not in HOT_PROTOCOLS:
            return None
        if any(not isinstance(c, dict) or not c.get("email") for c in old_clients + new_clients):
            return None
        old_by_email = {c["email"]: c for c in old_clients}
        new_by_email = {c["email"]: c for c in new_clients}
        if len(old_by_email) != len(old_clients) or len(new_by_email) != len(new_clients):
            return None  # duplicate emails: removing by email would be ambiguous

        # A changed client (new UUID after a reset, a different flow) is removed
        # and added back, since AlterInbound has no "update user".
        removes = [e for e, c in old_by_email.items() if new_by_email.get(e) != c]
        adds = [c for e, c in new_by_email.items() if old_by_email.get(e) != c]
        if removes:
            diff.removes[tag] = removes
        if adds:
            inbound = deepcopy(after)
            inbound["settings"]["clients"] = adds
            diff.adds[tag] = inbound
    return diff


_DONE = re.compile(r"(?:Added|Removed) (\d+) user\(s\) in total")


def _run(args: list[str], expected: int) -> bool:
    """`xray api adu`/`rmu` exit 0 even when a user was refused ("already
    exists", "not found", an inbound that didn't build), so success is the
    count they report matching the count asked for."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.warning("xray api call failed: %s", exc)
        return False
    output = (result.stdout or "") + (result.stderr or "")
    match = _DONE.search(output)
    if result.returncode != 0 or not match or int(match.group(1)) != expected:
        log.warning("xray %s did not apply cleanly: %s", args[2], output.strip())
        return False
    return True


def apply(xray_bin: str, api_addr: str, diff: UserDiff) -> bool:
    """Removes first, then adds, so a re-added user never exists twice."""
    for tag, emails in diff.removes.items():
        if not _run([xray_bin, "api", "rmu", f"-server={api_addr}", f"-tag={tag}", *emails], len(emails)):
            return False
    if diff.adds:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"inbounds": list(diff.adds.values())}, f)
            path = f.name
        try:
            if not _run([xray_bin, "api", "adu", f"-server={api_addr}", path],
                        sum(len(_clients(inbound) or []) for inbound in diff.adds.values())):
                return False
        finally:
            os.unlink(path)
    return True
