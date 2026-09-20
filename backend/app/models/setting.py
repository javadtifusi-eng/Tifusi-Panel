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

    # The address handed to *customers*, which is deliberately allowed to differ
    # from public_url above. public_url is where the admin reaches this panel and
    # what it builds its own links from; a subscription link built on it tells
    # every customer the panel's real address, and burning that address burns the
    # dashboard along with it. Set this to a second domain pointing at the same
    # server and subscriptions go out on that one instead, so a domain that ends
    # up filtered or shared around can be swapped without moving the panel.
    # Empty falls back to public_url, which is how this behaved before.
    subscription_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Both required together for notifications to actually send — see
    # app/notifications/telegram.py. The chat ID is whatever Telegram gives
    # your bot for the target chat (a user, group, or channel it's in).
    telegram_bot_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # A generic outbound webhook — fired on the same events the Telegram
    # notifications above cover (user expired/limited/created, node up/
    # down), for admins wiring the panel into their own bot/CRM instead of
    # (or alongside) Telegram. The secret is sent back as a header so the
    # receiver can verify a request actually came from this panel.
    webhook_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    webhook_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # A Discord incoming-webhook URL — same events as Telegram/the generic
    # webhook, see app/notifications/discord.py.
    discord_webhook_url: Mapped[str | None] = mapped_column(String(500), nullable=True)