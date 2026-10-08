"""AgentForge integration (SPEC §18): profile version, eval mode, feedback and export status on runs.

Revision ID: 0002_agentforge
Revises: 0001_initial
"""

from alembic import op

revision = "0002_agentforge"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE runs
          ADD COLUMN IF NOT EXISTS profile_version text,
          ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'live',
          ADD COLUMN IF NOT EXISTS case_id text,
          ADD COLUMN IF NOT EXISTS feedback_thumbs smallint CHECK (feedback_thumbs IN (-1, 1)),
          ADD COLUMN IF NOT EXISTS feedback_comment text,
          ADD COLUMN IF NOT EXISTS exported_at timestamptz;
        CREATE TABLE IF NOT EXISTS app_meta (
          key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz DEFAULT now()
        );
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE runs DROP COLUMN IF EXISTS profile_version, DROP COLUMN IF EXISTS mode, "
        "DROP COLUMN IF EXISTS case_id, DROP COLUMN IF EXISTS feedback_thumbs, "
        "DROP COLUMN IF EXISTS feedback_comment, DROP COLUMN IF EXISTS exported_at"
    )
