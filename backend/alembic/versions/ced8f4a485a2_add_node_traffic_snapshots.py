"""add node_traffic_snapshots table

Revision ID: ced8f4a485a2
Revises: d5b6955333d6
Create Date: 2026-09-10 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ced8f4a485a2'
down_revision: Union[str, Sequence[str], None] = 'd5b6955333d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'node_traffic_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('node_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('total_bytes', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['node_id'], ['nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('node_id', 'date', name='uq_node_traffic_date'),
    )
    op.create_index(op.f('ix_node_traffic_snapshots_node_id'), 'node_traffic_snapshots', ['node_id'], unique=False)
    op.create_index(op.f('ix_node_traffic_snapshots_date'), 'node_traffic_snapshots', ['date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_node_traffic_snapshots_date'), table_name='node_traffic_snapshots')
    op.drop_index(op.f('ix_node_traffic_snapshots_node_id'), table_name='node_traffic_snapshots')
    op.drop_table('node_traffic_snapshots')
