from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as env_settings
from app.models.setting import PanelSetting

_ROW_ID = 1


async def get_settings_row(db: AsyncSession) -> PanelSetting:
    """Bootstraps the settings row from the env-var default (TIFUSI_PUBLIC_URL)
    the first time anything asks for it, then leaves it alone — once an admin
    has edited it through the Settings page, the DB value wins even if the
    admin clears it back to empty."""
    row = await db.get(PanelSetting, _ROW_ID)
    if row is None:
        row = PanelSetting(id=_ROW_ID, public_url=env_settings.public_url)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def get_public_url(db: AsyncSession) -> str | None:
    row = await get_settings_row(db)
    return row.public_url
