from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.schemas.settings import PanelSettingsResponse, PanelSettingsUpdate
from app.settings_store import get_settings_row

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(get_current_admin)])


@router.get("", response_model=PanelSettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)) -> PanelSettingsResponse:
    return await get_settings_row(db)


@router.put("", response_model=PanelSettingsResponse)
async def update_settings(payload: PanelSettingsUpdate, db: AsyncSession = Depends(get_db)) -> PanelSettingsResponse:
    row = await get_settings_row(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
