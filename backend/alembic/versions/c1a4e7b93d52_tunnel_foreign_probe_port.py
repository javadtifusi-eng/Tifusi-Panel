"""add tunnels.foreign_port

The reachability check for a tunnel's foreign side used to assume SSH on
port 22, which silently reported "foreign side not reachable" whenever the
admin ran SSH elsewhere or firewalled it. NULL keeps the old default.

Revision ID: c1a4e7b93d52
Revises: b9e4d2a7c1f3
Create Date: 2026-09-16 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a4e7b93d52'
down_revision: Union[str, Sequence[str], None] = 'b9e4d2a7c1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tunnels', sa.Column('foreign_port', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('tunnels', 'foreign_port')
