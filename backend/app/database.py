import asyncio
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


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
