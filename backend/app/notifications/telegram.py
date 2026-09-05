import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings_store import get_settings_row

# A plain module attribute, not a constant folded into the function at
# import time — tests point this at a local stub server instead of the real
# Telegram API by reassigning it before calling send_telegram_message.
TELEGRAM_API_BASE = "https://api.telegram.org"


async def send_telegram_message(db: AsyncSession, text: str) -> bool:
    """Best-effort: a Telegram outage (or nothing configured) must never
    break the caller — enforce_limits and check_node_health both call this
    after already doing their real work, so a failed notification here
    should never roll anything back or raise."""
    row = await get_settings_row(db)
    if not row.telegram_bot_token or not row.telegram_chat_id:
        return False

    url = f"{TELEGRAM_API_BASE}/bot{row.telegram_bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, json={"chat_id": row.telegram_chat_id, "text": text})
            resp.raise_for_status()
        return True
    except httpx.HTTPError:
        return False
