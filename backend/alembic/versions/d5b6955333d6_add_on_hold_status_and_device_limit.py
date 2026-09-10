"""add on_hold user status and device (hwid) limit

Revision ID: d5b6955333d6
Revises: 6d87bd5b4d50
Create Date: 2026-09-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5b6955333d6'
down_revision: Union[str, Sequence[str], None] = '6d87bd5b4d50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite enforces the enum as a CHECK constraint baked in at table
    # creation — adding a new allowed value needs the full batch-mode
    # table rebuild, a plain ADD COLUMN can't touch an existing constraint.
    with op.batch_alter_table('proxy_users', schema=None) as batch_op:
        batch_op.alter_column(
            'status',
            existing_type=sa.Enum('active', 'disabled', 'expired', 'limited', name='userstatus'),
            type_=sa.Enum('active', 'disabled', 'expired', 'limited', 'on_hold', name='userstatus'),
            existing_nullable=False,
        )
        batch_op.add_column(sa.Column('on_hold_expire_days', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('hwid_limit', sa.BigInteger(), nullable=True))

    op.create_table(
        'user_devices',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('identifier', sa.String(length=128), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['proxy_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'identifier', name='uq_user_device'),
    )
    op.create_index(op.f('ix_user_devices_user_id'), 'user_devices', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_devices_user_id'), table_name='user_devices')
    op.drop_table('user_devices')
    with op.batch_alter_table('proxy_users', schema=None) as batch_op:
        batch_op.drop_column('hwid_limit')
        batch_op.drop_column('on_hold_expire_days')
        batch_op.alter_column(
            'status',
            existing_type=sa.Enum('active', 'disabled', 'expired', 'limited', 'on_hold', name='userstatus'),
            type_=sa.Enum('active', 'disabled', 'expired', 'limited', name='userstatus'),
            existing_nullable=False,
        )
