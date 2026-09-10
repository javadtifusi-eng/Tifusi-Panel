from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.models.api_key import ApiKey
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreateResponse, ApiKeyList, ApiKeyListItem
from app.security import generate_api_key, hash_api_key

# Plain get_current_admin, not require_permission: managing your OWN keys
# is always available regardless of scope — a key can never grant more
# than the admin who owns it already has (see app.dependencies.
# get_current_admin resolving a key straight to its admin row), so there's
# nothing to gate here beyond "you have to be a real, logged-in admin".
router = APIRouter(prefix="/api/api-keys", tags=["api-keys"], dependencies=[Depends(get_current_admin)])


@router.get("", response_model=ApiKeyList)
async def list_api_keys(
    admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> ApiKeyList:
    result = await db.execute(select(ApiKey).where(ApiKey.admin_id == admin.id).order_by(ApiKey.id.desc()))
    keys = list(result.scalars().all())
    return ApiKeyList(total=len(keys), keys=[ApiKeyListItem.model_validate(k) for k in keys])


@router.post("", response_model=ApiKeyCreateResponse, status_code=201)
async def create_api_key(
    payload: ApiKeyCreate, admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> ApiKeyCreateResponse:
    raw_key = generate_api_key()
    api_key = ApiKey(
        admin_id=admin.id,
        name=payload.name,
        key_hash=hash_api_key(raw_key),
        key_prefix=raw_key[:16],
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    return ApiKeyCreateResponse(
        id=api_key.id,
        name=api_key.name,
        key=raw_key,
        key_prefix=api_key.key_prefix,
        created_at=api_key.created_at,
    )


@router.delete("/{key_id}", status_code=204)
async def delete_api_key(
    key_id: int, admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> None:
    key = await db.get(ApiKey, key_id)
    if key is None or key.admin_id != admin.id:
        raise HTTPException(status_code=404, detail="API key not found")
    await db.delete(key)
    await db.commit()
