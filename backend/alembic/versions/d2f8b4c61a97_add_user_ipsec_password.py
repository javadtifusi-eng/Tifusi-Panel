"""add proxy_users.ipsec_password

A user-chosen IKEv2/L2TP login password, separate from `secret` (which is
also the subscription URL token and VLESS UUID). NULL keeps using `secret`.

Revision ID: d2f8b4c61a97
Revises: c1a4e7b93d52
Create Date: 2026-09-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f8b4c61a97'
down_revision: Union[str, Sequence[str], None] = 'c1a4e7b93d52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('proxy_users', sa.Column('ipsec_password', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('proxy_users', 'ipsec_password')
