from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.admin import Admin
from app.rate_limit import check, client_key, record_failure, reset
from app.schemas.auth import LoginRequest, TokenResponse
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Two windows at once: a per-IP+username cap that catches someone grinding
# one account's password, and a looser per-IP cap that catches the same
# attacker spraying many usernames from one address so the first limit
# alone wouldn't slow them down.
_PER_ACCOUNT_MAX, _PER_ACCOUNT_WINDOW = 6, 300.0
_PER_IP_MAX, _PER_IP_WINDOW = 20, 300.0


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    ip_key = client_key(request)
    account_key = client_key(request, payload.username.lower())
    check(ip_key, max_attempts=_PER_IP_MAX, window_seconds=_PER_IP_WINDOW)
    check(account_key, max_attempts=_PER_ACCOUNT_MAX, window_seconds=_PER_ACCOUNT_WINDOW)

    result = await db.execute(select(Admin).where(Admin.username == payload.username))
    admin = result.scalar_one_or_none()
    if admin is None or not verify_password(payload.password, admin.hashed_password):
        record_failure(ip_key)
        record_failure(account_key)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Only the per-account counter clears on success — the per-IP counter
    # stays, so guessing one account's password correctly doesn't buy an
    # attacker a fresh allowance to go spray-guess the next username.
    reset(account_key)
    return TokenResponse(
        access_token=create_access_token(subject=admin.username, token_version=admin.token_version)
    )
