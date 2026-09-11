import asyncio
import secrets
from datetime import datetime, timedelta, timezone

import typer

from app.config import settings
from app.database import async_session, init_db
from app.models.setup_key import SetupKey
from app.version import __version__

# Typer collapses a Typer() app down to a single bare command (dropping the
# subcommand name entirely) whenever exactly one command is registered — so
# with only generate-admin-key here, `tifusi-cli generate-admin-key` would
# fail with "unexpected extra argument". The `version` command keeps Typer
# in normal multi-command dispatch mode as more admin commands are added.
cli = typer.Typer(help="Tifusi Panel command line interface")


# Big block-letter "TIFUSI" (figlet -f big) — this is what actually reads
# as a real banner on a real terminal; the previous version was a small
# bordered box that just didn't stand out. 43 columns wide, still well
# under a phone SSH client's ~80-column width so it doesn't wrap.
_BIG_TIFUSI = r"""
 _______ _____ ______ _    _  _____ _____
|__   __|_   _|  ____| |  | |/ ____|_   _|
   | |    | | | |__  | |  | | (___   | |
   | |    | | |  __| | |  | |\___ \  | |
   | |   _| |_| |    | |__| |____) |_| |_
   |_|  |_____|_|     \____/|_____/|_____|
"""


def _print_banner() -> None:
    # typer.secho already strips these escapes when stdout isn't a real
    # terminal (piped into a log, NO_COLOR set, etc.) — no extra check
    # needed here the way the plain-printf shell installers require.
    typer.echo("")
    for line in _BIG_TIFUSI.strip("\n").splitlines():
        typer.secho(line, fg=typer.colors.CYAN, bold=True)
    typer.echo("")
    typer.secho(f"  Tifusi Panel  ", fg=typer.colors.BLACK, bg=typer.colors.CYAN, bold=True, nl=False)
    typer.secho(f" v{__version__}", fg=typer.colors.YELLOW, bold=True)
    typer.secho("  GitHub: https://github.com/javadtifusi-eng/Tifusi-Panel", fg=typer.colors.BRIGHT_BLACK)


@cli.command("version")
def show_version() -> None:
    """Print the installed Tifusi Panel version."""
    typer.echo(__version__)


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

    _print_banner()
    typer.secho(
        f"\n  Setup key (valid for {settings.setup_key_ttl_minutes} minutes):\n",
        fg=typer.colors.CYAN,
        bold=True,
    )
    typer.secho(f"    {key}\n", fg=typer.colors.GREEN, bold=True)
    typer.echo("  Paste it into the Tifusi Panel login page to create the admin account.\n")


if __name__ == "__main__":
    cli()
