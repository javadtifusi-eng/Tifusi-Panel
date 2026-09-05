"""Runs Alembic's migrations programmatically, called from app.database.init_db()
on every app startup so `docker compose up` (or a plain uvicorn run) always
ends up on the latest schema without a separate manual migration step.

alembic/env.py's online-migration path uses a plain sync engine (not
aiosqlite), so alembic.command.upgrade() is fully synchronous top to
bottom — safe to run via asyncio.to_thread() from inside the app's async
lifespan without any asyncio.run()-inside-a-running-loop conflict.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return cfg


def upgrade_to_head() -> None:
    command.upgrade(_alembic_config(), "head")
