from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.database import Base


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)

    # Embedded in every access token this admin is issued (see
    # app/security.create_access_token) and checked on every request (see
    # app/dependencies.get_current_admin). Bumped by change_password so a
    # token issued before a password change — leaked or not — stops working
    # immediately instead of staying valid for the rest of its normal
    # lifetime (access_token_expire_minutes).
    token_version: Mapped[int] = mapped_column(Integer, default=0)

    # None = unrestricted (full access, same as every admin before this
    # existed); a list restricts this admin to exactly those scopes (see
    # app/permissions.py). Never consulted for the owner — see
    # app/dependencies.require_permission.
    permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Reseller accounts (see app/resellers.py): limited to their own users,
    # to the protocols below and, when set, to a user count and a total volume
    # in bytes. None on a limit means no limit of that kind.
    is_reseller: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    max_users: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_quota: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    protocols: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Profile picture shown in the sidebar, as a data: URL. The dashboard
    # shrinks the image before upload and app/schemas/admin.AvatarUpdate caps
    # the size, so it fits a MySQL TEXT column too.
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
