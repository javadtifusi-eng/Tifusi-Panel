"""add proxy_users.admin_id (reseller-style admin ownership)

Revision ID: 967b8cd51f9b
Revises: 564fbec6b371
Create Date: 2026-09-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '967b8cd51f9b'
down_revision: Union[str, Sequence[str], None] = '564fbec6b371'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('proxy_users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('admin_id', sa.Integer(), nullable=True))
        batch_op.create_index(op.f('ix_proxy_users_admin_id'), ['admin_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_proxy_users_admin_id', 'admins', ['admin_id'], ['id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    with op.batch_alter_table('proxy_users', schema=None) as batch_op:
        batch_op.drop_constraint('fk_proxy_users_admin_id', type_='foreignkey')
        batch_op.drop_index(op.f('ix_proxy_users_admin_id'))
        batch_op.drop_column('admin_id')
