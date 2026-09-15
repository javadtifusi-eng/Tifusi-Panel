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
from sqlalchemy import create_engine, inspect
from sqlalchemy.pool import NullPool

from app.config import settings

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return cfg


def _bootstrap_empty_mysql(cfg: Config) -> bool:
    """The professional edition (MySQL) is always a fresh install. The early
    migrations were written against SQLite's batch table rebuilds and fail on
    MySQL (e.g. dropping a column still referenced by a foreign key), so an
    empty MySQL database gets the current schema straight from the models and
    is stamped at head; every later migration then runs normally on both."""
    engine = create_engine(settings.database_url.replace("mysql+aiomysql://", "mysql+pymysql://"), poolclass=NullPool)
    try:
        if inspect(engine).get_table_names():
            return False
        import app.models  # noqa: F401 — registers every model on Base.metadata
        from app.database import Base

        Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    command.stamp(cfg, "head")
    return True


def upgrade_to_head() -> None:
    cfg = _alembic_config()
    if settings.database_url.startswith("mysql") and _bootstrap_empty_mysql(cfg):
        return
    command.upgrade(cfg, "head")
