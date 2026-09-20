"""A subscription address separate from the panel's own

public_url served two jobs at once: where the admin reaches the panel, and the
base every customer's subscription link is built on. So handing out a second
domain for customers meant moving the dashboard onto it too. Splitting them lets
a domain that gets filtered or passed around be replaced without touching where
the panel lives. Empty falls back to public_url, so nothing changes until it is
set.

Revision ID: b5e08d2a1f37
Revises: a7f31c9e5b04
"""

import sqlalchemy as sa
from alembic import op

revision = "b5e08d2a1f37"
down_revision = "a7f31c9e5b04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("panel_settings") as batch_op:
        batch_op.add_column(sa.Column("subscription_url", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("panel_settings") as batch_op:
        batch_op.drop_column("subscription_url")
