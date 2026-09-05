import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import async_session, init_db
from app.routers import auth, groups, hosts, nodes, reality, setup, subscription, users
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


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(setup.router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(reality.router)
    app.include_router(hosts.router)
    app.include_router(subscription.router)
    app.include_router(nodes.router)
    app.include_router(groups.router)

    return app
