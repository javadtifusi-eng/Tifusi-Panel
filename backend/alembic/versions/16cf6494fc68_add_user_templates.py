"""add user_templates table

Revision ID: 16cf6494fc68
Revises: 34c30f331500
Create Date: 2026-09-09 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '16cf6494fc68'
down_revision: Union[str, Sequence[str], None] = '34c30f331500'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('data_limit', sa.BigInteger(), nullable=True),
        sa.Column('expire_days', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_templates_name'), 'user_templates', ['name'], unique=True)
    op.create_table(
        'user_template_groups',
        sa.Column('user_template_id', sa.Integer(), nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['user_template_id'], ['user_templates.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['group_id'], ['groups.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_template_id', 'group_id'),
    )


def downgrade() -> None:
    op.drop_table('user_template_groups')
    op.drop_index(op.f('ix_user_templates_name'), table_name='user_templates')
    op.drop_table('user_templates')
