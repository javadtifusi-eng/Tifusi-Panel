from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

user_template_groups = Table(
    "user_template_groups",
    Base.metadata,
    Column("user_template_id", ForeignKey("user_templates.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
)


class UserTemplate(Base):
    """A saved preset (data limit / expiry / groups) an admin picks from
    when creating a user or a batch of users, instead of retyping the same
    values every time."""

    __tablename__ = "user_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)

    # None/0 means unlimited.
    data_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Days from the moment the template is applied, not an absolute date —
    # resolved to a concrete `expire` datetime by the caller at creation time.
    expire_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    groups: Mapped[list["Group"]] = relationship(  # noqa: F821
        "Group", secondary=user_template_groups, lazy="selectin"
    )

    @property
    def group_ids(self) -> list[int]:
        return [g.id for g in self.groups]
