"""add traffic_snapshots table

Revision ID: 6d87bd5b4d50
Revises: c83dbf1ca624
Create Date: 2026-09-09 23:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6d87bd5b4d50'
down_revision: Union[str, Sequence[str], None] = 'c83dbf1ca624'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'traffic_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('total_bytes', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_traffic_snapshots_date'), 'traffic_snapshots', ['date'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_traffic_snapshots_date'), table_name='traffic_snapshots')
    op.drop_table('traffic_snapshots')
