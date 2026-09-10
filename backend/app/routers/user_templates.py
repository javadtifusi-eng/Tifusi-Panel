from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.group import Group
from app.models.user_template import UserTemplate
from app.schemas.user_template import (
    UserTemplateCreate,
    UserTemplateList,
    UserTemplateResponse,
    UserTemplateUpdate,
)

router = APIRouter(
    prefix="/api/user-templates", tags=["user-templates"], dependencies=[Depends(require_permission("users"))]
)


async def _resolve_groups(ids: list[int], db: AsyncSession) -> list[Group]:
    if not ids:
        return []
    result = await db.execute(select(Group).where(Group.id.in_(ids)))
    groups = list(result.scalars().all())
    if len(groups) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more group_ids not found")
    return groups


async def _get_template_or_404(template_id: int, db: AsyncSession) -> UserTemplate:
    template = await db.get(UserTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.get("", response_model=UserTemplateList)
async def list_user_templates(db: AsyncSession = Depends(get_db)) -> UserTemplateList:
    total = await db.scalar(select(func.count()).select_from(UserTemplate))
    result = await db.execute(select(UserTemplate).order_by(UserTemplate.id.desc()))
    return UserTemplateList(total=total or 0, templates=list(result.scalars().all()))


@router.post("", response_model=UserTemplateResponse, status_code=201)
async def create_user_template(payload: UserTemplateCreate, db: AsyncSession = Depends(get_db)) -> UserTemplate:
    existing = await db.scalar(select(UserTemplate).where(UserTemplate.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A template with this name already exists")

    template = UserTemplate(
        name=payload.name, data_limit=payload.data_limit, expire_days=payload.expire_days, note=payload.note
    )
    template.groups = await _resolve_groups(payload.group_ids, db)
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.put("/{template_id}", response_model=UserTemplateResponse)
async def update_user_template(
    template_id: int, payload: UserTemplateUpdate, db: AsyncSession = Depends(get_db)
) -> UserTemplate:
    template = await _get_template_or_404(template_id, db)

    if payload.name is not None and payload.name != template.name:
        existing = await db.scalar(select(UserTemplate).where(UserTemplate.name == payload.name))
        if existing is not None:
            raise HTTPException(status_code=409, detail="A template with this name already exists")

    updates = payload.model_dump(exclude_unset=True, exclude={"group_ids"})
    for field, value in updates.items():
        setattr(template, field, value)

    if payload.group_ids is not None:
        template.groups = await _resolve_groups(payload.group_ids, db)

    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=204)
async def delete_user_template(template_id: int, db: AsyncSession = Depends(get_db)) -> None:
    template = await _get_template_or_404(template_id, db)
    await db.delete(template)
    await db.commit()
