from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PanelSetting(Base):
    """A single row (id is always 1) holding panel-wide config that needs to
    be editable at runtime instead of only via env vars/.env before startup.
    A real key-value table isn't worth the complexity yet for one field —
    add more nullable columns here as more runtime-editable settings show up."""

    __tablename__ = "panel_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    public_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Both required together for notifications to actually send — see
    # app/notifications/telegram.py. The chat ID is whatever Telegram gives
    # your bot for the target chat (a user, group, or channel it's in).
    telegram_bot_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Anthropic API key for the in-panel AI assistant (app/ai/*) — unset by
    # default, the assistant tab stays disabled until an admin pastes one in.
    ai_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
