import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

# A recognizable prefix, checked before even trying a JWT decode — lets
# get_current_admin tell "this is an API key" from "this is a session
# token" without touching the database for the common (JWT) case.
API_KEY_PREFIX = "tifusi_"


def generate_api_key() -> str:
    return API_KEY_PREFIX + secrets.token_urlsafe(32)


def hash_api_key(key: str) -> str:
    # sha256, not bcrypt: the key itself already has 32 bytes of real
    # entropy (unlike a human password), so a fast, deterministic hash
    # that supports an indexed equality lookup is the right tool here —
    # bcrypt's per-hash salt would mean scanning every stored key to find
    # a match instead of one indexed query.
    return hashlib.sha256(key.encode()).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except jwt.PyJWTError:
        return None
    return payload.get("sub")
