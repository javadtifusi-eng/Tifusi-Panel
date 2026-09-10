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


def _print_banner() -> None:
    # typer.secho already strips these escapes when stdout isn't a real
    # terminal (piped into a log, NO_COLOR set, etc.) — no extra check
    # needed here the way the plain-printf shell installers require.
    #
    # Kept narrow on purpose (~20 cols) despite wanting to stand out more —
    # a wider box wraps mid-line on a narrow terminal (a phone SSH client
    # running `docker exec -it`, for instance) and comes out looking like
    # garbled rows of "=" instead of a box — same tradeoff install.sh's own
    # banner() makes. Extra blank padding rows plus a bold title read as
    # bigger without widening it.
    title = "TIFUSI PANEL"
    text = f"   {title}   "
    width = len(text)
    blank = " " * width

    def side(inner: str) -> str:
        # Each piece styled (and reset) on its own, then joined — nesting a
        # differently-colored segment inside one typer.secho(fg=...) call
        # would have the inner segment's own reset code prematurely cancel
        # the outer color for whatever comes after it.
        return (
            typer.style("  ║", fg=typer.colors.CYAN, bold=True)
            + inner
            + typer.style("║", fg=typer.colors.CYAN, bold=True)
        )

    typer.echo("")
    typer.secho("  ╔" + "═" * width + "╗", fg=typer.colors.CYAN, bold=True)
    typer.echo(side(typer.style(blank, fg=typer.colors.CYAN, bold=True)))
    typer.echo(side(typer.style(text, fg=typer.colors.YELLOW, bold=True)))
    typer.echo(side(typer.style(blank, fg=typer.colors.CYAN, bold=True)))
    typer.secho("  ╚" + "═" * width + "╝", fg=typer.colors.CYAN, bold=True)


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
