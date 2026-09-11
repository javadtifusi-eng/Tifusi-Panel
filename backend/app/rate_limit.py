"""A small in-process sliding-window limiter for the panel's unauthenticated
endpoints (login, first-run admin setup) — without it, nothing stops an
attacker from guessing a password or setup key as fast as the network lets
them. In-memory by design: the panel always runs as one uvicorn process
(see backend/run.py and the Dockerfile CMD), so this doesn't need to survive
a restart or be shared across workers to do its job.
"""
import time
from collections import defaultdict

from fastapi import HTTPException, Request

_attempts: dict[str, list[float]] = defaultdict(list)


def client_key(request: Request, *parts: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return ":".join((ip, *parts)) if parts else ip


def check(key: str, *, max_attempts: int, window_seconds: float) -> None:
    """Raises 429 if `key` has already hit `max_attempts` within the last
    `window_seconds`. Call this before doing the real (slow, bcrypt-backed)
    credential check, so a locked-out caller doesn't even pay for that."""
    now = time.monotonic()
    attempts = _attempts[key]
    cutoff = now - window_seconds
    while attempts and attempts[0] < cutoff:
        attempts.pop(0)
    if len(attempts) >= max_attempts:
        retry_after = int(attempts[0] + window_seconds - now) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts — try again in {retry_after}s",
            headers={"Retry-After": str(retry_after)},
        )


def record_failure(key: str) -> None:
    _attempts[key].append(time.monotonic())


def reset(key: str) -> None:
    _attempts.pop(key, None)
