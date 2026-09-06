"""add ai_api_key setting

Revision ID: a3f9c1d2e4b7
Revises: 1fc38d7e8d1b
Create Date: 2026-09-06 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c1d2e4b7'
down_revision: Union[str, Sequence[str], None] = '1fc38d7e8d1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('panel_settings', sa.Column('ai_api_key', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('panel_settings', 'ai_api_key')
