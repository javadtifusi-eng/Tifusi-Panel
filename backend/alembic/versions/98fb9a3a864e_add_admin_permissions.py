"""add admin.permissions (per-admin scope restriction)

Revision ID: 98fb9a3a864e
Revises: 27f27f6ee35d
Create Date: 2026-09-09 21:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '98fb9a3a864e'
down_revision: Union[str, Sequence[str], None] = '27f27f6ee35d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable, no backfill needed — NULL is the correct value for every
    # admin that already exists (unrestricted, exactly today's behavior).
    op.add_column('admins', sa.Column('permissions', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('admins', 'permissions')
