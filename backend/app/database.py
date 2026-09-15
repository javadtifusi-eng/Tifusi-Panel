import asyncio
from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


# The default pool (5 + 10 overflow) deadlocked under ~20 concurrent user
# edits: each request still holds its connection while the node-resync
# background task it scheduled waits for another one. A 2,000-user load test
# timed out half the writes at the default size and none at this one.
_engine_options: dict = {"echo": False, "pool_size": 30, "max_overflow": 30, "pool_timeout": 30}
if settings.database_url.startswith("mysql"):
    # MySQL closes idle connections after wait_timeout; ping before use and
    # recycle hourly so a quiet night doesn't leave the pool full of dead ones.
    _engine_options.update(pool_pre_ping=True, pool_recycle=3600)
engine = create_async_engine(settings.database_url, **_engine_options)
async_session = async_sessionmaker(engine, expire_on_commit=False)

if engine.dialect.name == "sqlite":

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record) -> None:
        # SQLite's default rollback journal makes every write block every
        # reader; under a load test (admin edits while thousands of clients
        # fetch subscriptions) requests queued behind that lock for minutes.
        # WAL lets readers and the single writer proceed concurrently, and
        # busy_timeout makes a second writer wait instead of failing fast.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=15000")
        cursor.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        yield session


async def init_db() -> None:
    # Runs Alembic's migrations up to "head" instead of Base.metadata.create_all()
    # — the schema can now evolve (a new column, a new table) without ever
    # having to drop and recreate the database. See app/migrate.py for why
    # this needs its own thread.
    from app.migrate import upgrade_to_head  # deferred: avoids importing alembic on every app import

    await asyncio.to_thread(upgrade_to_head)
