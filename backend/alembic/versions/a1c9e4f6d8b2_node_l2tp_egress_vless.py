"""add node l2tp_egress_vless column

Revision ID: a1c9e4f6d8b2
Revises: f7a1d9c3b2e4
Create Date: 2026-09-07 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9e4f6d8b2'
down_revision: Union[str, Sequence[str], None] = 'f7a1d9c3b2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('nodes', sa.Column('l2tp_egress_vless', sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column('nodes', 'l2tp_egress_vless')
