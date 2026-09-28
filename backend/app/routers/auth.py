from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import totp
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import Admin
from app.rate_limit import check, client_key, record_failure, reset
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    TwoFactorCode,
    TwoFactorDisable,
    TwoFactorRecoveryCodes,
    TwoFactorSetup,
    TwoFactorStatus,
)
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

    if admin.disabled:
        raise HTTPException(status_code=403, detail="This account has been disabled")

    if admin.totp_enabled:
        if not payload.otp:
            # Not a failure: the password was right and the client now asks for the code.
            raise HTTPException(status_code=401, detail="otp_required")
        if not _accept_second_factor(admin, payload.otp):
            record_failure(ip_key)
            record_failure(account_key)
            raise HTTPException(status_code=401, detail="Invalid two-factor code")
        db.add(admin)
        await db.commit()

    # Only the per-account counter clears on success — the per-IP counter
    # stays, so guessing one account's password correctly doesn't buy an
    # attacker a fresh allowance to go spray-guess the next username.
    reset(account_key)
    return TokenResponse(
        access_token=create_access_token(subject=admin.username, token_version=admin.token_version)
    )


def _accept_second_factor(admin: Admin, code: str) -> bool:
    """An authenticator code (not reused) or an unused recovery code, which is then spent."""
    step = totp.verify(admin.totp_secret or "", code, admin.totp_last_step)
    if step is not None:
        admin.totp_last_step = step
        return True
    hashes = list(admin.totp_recovery_hashes or [])
    digest = totp.hash_recovery_code(code)
    if digest in hashes:
        hashes.remove(digest)
        admin.totp_recovery_hashes = hashes
        return True
    return False


@router.get("/2fa", response_model=TwoFactorStatus)
async def two_factor_status(admin: Admin = Depends(get_current_admin)) -> TwoFactorStatus:
    return TwoFactorStatus(enabled=bool(admin.totp_enabled), recovery_codes_left=len(admin.totp_recovery_hashes or []))


@router.post("/2fa/setup", response_model=TwoFactorSetup)
async def two_factor_setup(admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)) -> TwoFactorSetup:
    """Starts (or restarts) setup with a fresh secret for the QR code. Login keeps working without a code
    until /2fa/enable confirms the app produces valid codes for it."""
    if admin.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-factor login is already on; turn it off first")
    admin.totp_secret = totp.new_secret()
    admin.totp_last_step = None
    db.add(admin)
    await db.commit()
    return TwoFactorSetup(secret=admin.totp_secret, otpauth_uri=totp.provisioning_uri(admin.totp_secret, admin.username))


@router.post("/2fa/enable", response_model=TwoFactorRecoveryCodes)
async def two_factor_enable(
    payload: TwoFactorCode, admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> TwoFactorRecoveryCodes:
    if admin.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-factor login is already on")
    if not admin.totp_secret:
        raise HTTPException(status_code=400, detail="Start setup first")
    step = totp.verify(admin.totp_secret, payload.code)
    if step is None:
        raise HTTPException(status_code=400, detail="That code is not right. Check the phone's clock and try the newest code")
    codes = totp.new_recovery_codes()
    admin.totp_enabled = True
    admin.totp_last_step = step
    admin.totp_recovery_hashes = [totp.hash_recovery_code(c) for c in codes]
    db.add(admin)
    await db.commit()
    return TwoFactorRecoveryCodes(recovery_codes=codes)


@router.post("/2fa/disable", status_code=204)
async def two_factor_disable(
    payload: TwoFactorDisable, request: Request, admin: Admin = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> None:
    key = client_key(request, f"2fa-off:{admin.username}")
    check(key, max_attempts=_PER_ACCOUNT_MAX, window_seconds=_PER_ACCOUNT_WINDOW)
    if not verify_password(payload.password, admin.hashed_password) or not _accept_second_factor(admin, payload.code):
        record_failure(key)
        raise HTTPException(status_code=401, detail="Password or code is not right")
    _clear_two_factor(admin)
    db.add(admin)
    await db.commit()


def _clear_two_factor(admin: Admin) -> None:
    admin.totp_enabled = False
    admin.totp_secret = None
    admin.totp_last_step = None
    admin.totp_recovery_hashes = None
