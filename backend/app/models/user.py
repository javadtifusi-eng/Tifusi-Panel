import enum
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserStatus(str, enum.Enum):
    active = "active"
    disabled = "disabled"
    expired = "expired"
    limited = "limited"


class ProxyUser(Base):
    __tablename__ = "proxy_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus), default=UserStatus.active)

    # None/0 means unlimited.
    data_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    used_traffic: Mapped[int] = mapped_column(BigInteger, default=0)

    expire: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
