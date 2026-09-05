"""Optional entrypoint for running the panel with direct TLS termination in
uvicorn itself — for a deployment with no nginx/Caddy in front of it.

`uvicorn app.main:app --host ... --port ...` (what the Dockerfile uses by
default) still works exactly as before and is unaffected by anything here.
Use this instead only when TIFUSI_SSL_CERTFILE/TIFUSI_SSL_KEYFILE are set.
"""

import sys

import uvicorn

from app.config import settings


def main() -> None:
    if bool(settings.ssl_certfile) != bool(settings.ssl_keyfile):
        sys.exit("TIFUSI_SSL_CERTFILE and TIFUSI_SSL_KEYFILE must both be set, or neither")

    ssl_kwargs = {}
    if settings.ssl_certfile and settings.ssl_keyfile:
        ssl_kwargs = {"ssl_certfile": settings.ssl_certfile, "ssl_keyfile": settings.ssl_keyfile}

    uvicorn.run("app.main:app", host=settings.uvicorn_host, port=settings.uvicorn_port, **ssl_kwargs)


if __name__ == "__main__":
    main()
