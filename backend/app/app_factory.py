import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import async_session, init_db
from app.routers import admin, api_keys, auth, cores, groups, hosts, nodes, reality, settings as settings_router, setup, stats, subscription, system, tunnels, user_templates, users
from app.traffic.sync import run_traffic_cycle


async def _traffic_loop() -> None:
    """Runs run_traffic_cycle forever, one panel-wide instance for the life
    of the process — this is what actually keeps used_traffic real and
    expired/limited users off of Xray, instead of those being fields nobody
    ever updates."""
    while True:
        await asyncio.sleep(settings.traffic_sync_interval_seconds)
        async with async_session() as db:
            try:
                await run_traffic_cycle(db)
            except Exception:
                # A bad node/network blip shouldn't kill the loop for
                # everyone else — it just tries again next interval.
                continue


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(_traffic_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


# install.sh always generates a real TIFUSI_SECRET_KEY into .env — this
# only fires for someone who ran `docker compose up` directly against
# .env.example (or a hand-copied .env) without replacing either placeholder
# it ships with. Left running, either one means every admin JWT is
# forgeable by anyone who's read this file on GitHub — refusing to start is
# louder but a lot safer than a panel that quietly signs tokens with a
# secret the whole internet can read.
_INSECURE_SECRET_KEYS = {"change-me-in-production", "change-this-to-a-long-random-secret"}


def _check_secret_key() -> None:
    if settings.secret_key in _INSECURE_SECRET_KEYS or len(settings.secret_key) < 16:
        raise RuntimeError(
            "TIFUSI_SECRET_KEY is unset or still the placeholder from .env.example. "
            "Set it to a long random value before starting the panel — e.g.: "
            "openssl rand -hex 32"
        )


def create_app() -> FastAPI:
    _check_secret_key()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    # allow_credentials is deliberately NOT set (defaults to False): auth
    # here is a bearer token in the Authorization header (see
    # frontend/src/lib/api.ts), never a cookie, so there's nothing that
    # needs it. With allow_origins=["*"] (the default), turning it on would
    # make Starlette's CORSMiddleware reflect the request's actual Origin
    # back instead of a literal "*" — letting any site make credentialed
    # cross-origin requests for no benefit, since none exist to make.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(setup.router)
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(api_keys.router)
    app.include_router(users.router)
    app.include_router(user_templates.router)
    app.include_router(reality.router)
    app.include_router(hosts.router)
    app.include_router(subscription.router)
    app.include_router(nodes.router)
    app.include_router(groups.router)
    app.include_router(cores.router)
    app.include_router(settings_router.router)
    app.include_router(system.router)
    app.include_router(stats.router)
    app.include_router(tunnels.router)

    return app
