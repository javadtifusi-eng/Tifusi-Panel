import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings_store import get_settings_row


async def send_discord_message(db: AsyncSession, text: str) -> bool:
    """Same best-effort contract as send_telegram_message: never raises,
    called after the real work (enforce_limits, node health checks, user
    creation) already happened, so a dead webhook never rolls anything
    back. Discord's incoming-webhook API only needs a plain {"content":
    text} POST — no bot token/auth, the webhook URL itself is the secret."""
    row = await get_settings_row(db)
    if not row.discord_webhook_url:
        return False

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(row.discord_webhook_url, json={"content": text})
            resp.raise_for_status()
        return True
    except httpx.HTTPError:
        return False
