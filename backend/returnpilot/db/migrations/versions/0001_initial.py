"""Initial schema (SPEC §11 plus demo-sandbox and action-tracking columns).

Revision ID: 0001_initial
Revises:
"""

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  loyalty_tier text NOT NULL DEFAULT 'standard' CHECK (loyalty_tier IN ('standard','silver','gold')),
  shipping_pref text,
  country text NOT NULL DEFAULT 'US',
  template_key text,
  workspace_id uuid,
  seeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_template_ws ON customers (template_key, workspace_id) NULLS NOT DISTINCT
  WHERE template_key IS NOT NULL;
CREATE INDEX customers_workspace ON customers (workspace_id);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  github_login text,
  display_name text,
  role text NOT NULL CHECK (role IN ('customer','reviewer','admin')),
  customer_id uuid REFERENCES customers ON DELETE CASCADE,
  workspace_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX app_users_customer ON app_users (customer_id);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('apparel','footwear','electronics','home','accessories')),
  price numeric(10,2) NOT NULL,
  final_sale boolean NOT NULL DEFAULT false
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number int NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('processing','shipped','delivered','cancelled')),
  placed_at timestamptz NOT NULL,
  delivered_at timestamptz,
  shipping_country text NOT NULL DEFAULT 'US',
  shipping_cost numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL,
  customer_note text,
  UNIQUE (customer_id, order_number)
);
CREATE INDEX orders_customer ON orders (customer_id, placed_at DESC);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products,
  qty int NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price numeric(10,2) NOT NULL,
  discount numeric(10,2) NOT NULL DEFAULT 0,
  opened boolean
);
CREATE INDEX order_items_order ON order_items (order_id);
CREATE INDEX order_items_product ON order_items (product_id);

CREATE TABLE threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','escalated','waiting_approval','closed')),
  summary text,
  summary_upto int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_customer ON threads (customer_id, updated_at DESC);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  workspace_id uuid,
  run_id uuid,
  proposal_key text NOT NULL UNIQUE,
  action text NOT NULL,
  title text NOT NULL,
  args jsonb NOT NULL,
  amount numeric(10,2),
  max_amount numeric(10,2),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  agent_summary text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by text,
  decision jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX approvals_status ON approvals (status, created_at DESC);
CREATE INDEX approvals_workspace ON approvals (workspace_id, status);
CREATE INDEX approvals_thread ON approvals (thread_id);

CREATE TABLE returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  thread_id uuid REFERENCES threads ON DELETE SET NULL,
  approval_id uuid REFERENCES approvals ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending_approval','requested','label_created','received','rejected','expired','cancelled')),
  reason text,
  item_condition text,
  label_code text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX returns_item ON returns (order_item_id);
CREATE INDEX returns_thread ON returns (thread_id);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  thread_id uuid REFERENCES threads ON DELETE SET NULL,
  approval_id uuid REFERENCES approvals ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('pending_approval','queued','issued','failed','rejected','expired')),
  reason text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_item ON refunds (order_item_id);
CREATE INDEX refunds_customer ON refunds (customer_id, created_at DESC);
CREATE INDEX refunds_thread ON refunds (thread_id);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers ON DELETE CASCADE,
  thread_id uuid REFERENCES threads ON DELETE SET NULL,
  subject text NOT NULL,
  summary text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_thread ON tickets (thread_id);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','retrying','succeeded','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  celery_task_id text,
  thread_id uuid,
  customer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_status ON jobs (status, created_at);
CREATE INDEX jobs_thread ON jobs (thread_id);

CREATE TABLE outbox_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc text NOT NULL,
  doc_title text NOT NULL,
  section_id text NOT NULL,
  heading text NOT NULL,
  breadcrumb text NOT NULL,
  content text NOT NULL,
  ord int NOT NULL DEFAULT 0,
  content_hash text NOT NULL UNIQUE,
  embedding vector(768),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || content)) STORED
);
CREATE INDEX policy_chunks_embedding ON policy_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX policy_chunks_tsv ON policy_chunks USING gin (tsv);
CREATE INDEX policy_chunks_section ON policy_chunks (section_id);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'preference' CHECK (kind IN ('preference','fact')),
  embedding vector(768),
  source_thread_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memories_customer ON memories (customer_id);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid,
  customer_id uuid,
  workspace_id uuid,
  kind text NOT NULL DEFAULT 'turn',
  status text NOT NULL DEFAULT 'running',
  route text,
  model_primary text,
  total_ms int,
  llm_calls int NOT NULL DEFAULT 0,
  tool_calls int NOT NULL DEFAULT 0,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  first_user_text text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_created ON runs (created_at DESC);
CREATE INDEX runs_customer ON runs (customer_id, created_at DESC);
CREATE INDEX runs_workspace ON runs (workspace_id, created_at DESC);
CREATE INDEX runs_thread ON runs (thread_id);

CREATE TABLE run_steps (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs ON DELETE CASCADE,
  seq int NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  model text,
  started_at timestamptz NOT NULL,
  duration_ms int,
  tokens_in int,
  tokens_out int,
  status text NOT NULL DEFAULT 'ok',
  input_redacted jsonb,
  output_redacted jsonb,
  error text
);
CREATE INDEX run_steps_run ON run_steps (run_id, seq);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log (created_at DESC);

CREATE TABLE usage_counters (
  day date NOT NULL,
  provider text NOT NULL,
  kind text NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, kind)
);

CREATE TABLE eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite text NOT NULL,
  run_label text NOT NULL,
  scenario_id text NOT NULL,
  passed boolean NOT NULL,
  details jsonb,
  git_sha text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_results_created ON eval_results (suite, created_at DESC);
"""

TABLES = [
    "eval_results",
    "usage_counters",
    "audit_log",
    "run_steps",
    "runs",
    "memories",
    "policy_chunks",
    "outbox_emails",
    "jobs",
    "tickets",
    "refunds",
    "returns",
    "approvals",
    "threads",
    "order_items",
    "orders",
    "products",
    "app_users",
    "customers",
]


def upgrade() -> None:
    op.execute(SCHEMA)


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
