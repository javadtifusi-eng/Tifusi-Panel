"""add tunnel hamrang_quic

Revision ID: c3d6e9f2a1b4
Revises: f2c5a8d1b9e3
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

revision = "c3d6e9f2a1b4"
down_revision = "f2c5a8d1b9e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tunnels", sa.Column("hamrang_quic", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("tunnels", "hamrang_quic")
