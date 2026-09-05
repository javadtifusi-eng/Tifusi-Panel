from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.host import Host, HostSecurity
from app.reality.keys import generate_reality_keypair
from app.schemas.host import HostCreate, HostList, HostResponse, HostUpdate, RealityKeypairResponse

router = APIRouter(prefix="/api/hosts", tags=["hosts"], dependencies=[Depends(get_current_admin)])


def _missing_reality_fields(sni: str | None, public_key: str | None, private_key: str | None, short_id: str | None) -> list[str]:
    fields = {
        "sni": sni,
        "reality_public_key": public_key,
        "reality_private_key": private_key,
        "reality_short_id": short_id,
    }
    return [name for name, value in fields.items() if not value]


@router.get("/reality-keypair", response_model=RealityKeypairResponse)
async def reality_keypair() -> RealityKeypairResponse:
    return RealityKeypairResponse(**generate_reality_keypair())


@router.get("", response_model=HostList)
async def list_hosts(db: AsyncSession = Depends(get_db)) -> HostList:
    total = await db.scalar(select(func.count()).select_from(Host))
    result = await db.execute(select(Host).order_by(Host.id.desc()))
    return HostList(total=total or 0, hosts=list(result.scalars().all()))


@router.post("", response_model=HostResponse, status_code=201)
async def create_host(payload: HostCreate, db: AsyncSession = Depends(get_db)) -> Host:
    if payload.security == HostSecurity.reality:
        missing = _missing_reality_fields(
            payload.sni, payload.reality_public_key, payload.reality_private_key, payload.reality_short_id
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"REALITY requires: {', '.join(missing)}")

    host = Host(**payload.model_dump())
    db.add(host)
    await db.commit()
    await db.refresh(host)
    return host


async def _get_host_or_404(host_id: int, db: AsyncSession) -> Host:
    host = await db.get(Host, host_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host not found")
    return host


@router.get("/{host_id}", response_model=HostResponse)
async def get_host(host_id: int, db: AsyncSession = Depends(get_db)) -> Host:
    return await _get_host_or_404(host_id, db)


@router.put("/{host_id}", response_model=HostResponse)
async def update_host(host_id: int, payload: HostUpdate, db: AsyncSession = Depends(get_db)) -> Host:
    host = await _get_host_or_404(host_id, db)
    updates = payload.model_dump(exclude_unset=True)

    merged_security = updates.get("security", host.security)
    if merged_security == HostSecurity.reality:
        missing = _missing_reality_fields(
            updates.get("sni", host.sni),
            updates.get("reality_public_key", host.reality_public_key),
            updates.get("reality_private_key", host.reality_private_key),
            updates.get("reality_short_id", host.reality_short_id),
        )
        if missing:
            raise HTTPException(status_code=400, detail=f"REALITY requires: {', '.join(missing)}")

    for field, value in updates.items():
        setattr(host, field, value)

    db.add(host)
    await db.commit()
    await db.refresh(host)
    return host


@router.delete("/{host_id}", status_code=204)
async def delete_host(host_id: int, db: AsyncSession = Depends(get_db)) -> None:
    host = await _get_host_or_404(host_id, db)
    await db.delete(host)
    await db.commit()
