from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings_store import get_settings_row


async def send_webhook_event(db: AsyncSession, event: str, data: dict[str, Any]) -> bool:
    """Best-effort, same contract as send_telegram_message: a down/misconfigured
    receiver must never break the caller, which has always already done its
    real work by the time this is called."""
    row = await get_settings_row(db)
    if not row.webhook_url:
        return False

    headers = {"Content-Type": "application/json"}
    if row.webhook_secret:
        headers["X-Webhook-Secret"] = row.webhook_secret

    body = {"event": event, "timestamp": datetime.now(timezone.utc).isoformat(), "data": data}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(row.webhook_url, json=body, headers=headers)
            resp.raise_for_status()
        return True
    except httpx.HTTPError:
        return False
