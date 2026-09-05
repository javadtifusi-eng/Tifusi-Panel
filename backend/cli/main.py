import asyncio
import secrets
from datetime import datetime, timedelta, timezone

import typer

from app.config import settings
from app.database import async_session, init_db
from app.models.setup_key import SetupKey

cli = typer.Typer(help="Tifusi Panel command line interface")


@cli.command("generate-admin-key")
def generate_admin_key() -> None:
    """Generate a one-time key for creating the first admin account.

    Paste the printed key into the Tifusi Panel login page's first-run
    setup screen, right where the panel shows this same command.
    """
    asyncio.run(_generate_admin_key())


async def _generate_admin_key() -> None:
    await init_db()
    key = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.setup_key_ttl_minutes)

    async with async_session() as db:
        db.add(SetupKey(key=key, expires_at=expires_at))
        await db.commit()

    typer.secho(
        f"\nSetup key generated (valid for {settings.setup_key_ttl_minutes} minutes):\n",
        fg=typer.colors.CYAN,
        bold=True,
    )
    typer.secho(f"  {key}\n", fg=typer.colors.GREEN, bold=True)
    typer.echo("Paste it into the Tifusi Panel login page to create the admin account.")


if __name__ == "__main__":
    cli()
