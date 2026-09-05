import enum
import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.group import group_users


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

    # Doubles as the VLESS UUID, the Trojan/Hysteria2 password, and the
    # unguessable token in this user's subscription URL.
    secret: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, default=lambda: str(uuid_lib.uuid4())
    )

    # None/0 means unlimited.
    data_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    used_traffic: Mapped[int] = mapped_column(BigInteger, default=0)

    expire: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Empty = no restriction beyond global (ungrouped) hosts. See app/groups/access.py.
    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=group_users, back_populates="users", lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]
