"""add scanned to job_status enum

Revision ID: 0002_add_scanned_job_status
Revises: 0001_initial_schema
Create Date: 2026-05-15
"""

from alembic import op

revision = "0002_add_scanned_job_status"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'scanned'")


def downgrade() -> None:
    # Postgres does not support removing enum values; migrate rows away first then recreate.
    op.execute(
        "UPDATE analysis_jobs SET status = 'queued' WHERE status = 'scanned'"
    )
    # Cannot drop a value from a live enum in Postgres — document-only comment.
    # To fully remove 'scanned', recreate the enum without it (requires data migration).
