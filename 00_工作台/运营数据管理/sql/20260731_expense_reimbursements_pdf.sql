BEGIN;

CREATE TABLE IF NOT EXISTS expense_reimbursements (
  id TEXT PRIMARY KEY,
  expense_ids JSONB NOT NULL DEFAULT '[]',
  title TEXT DEFAULT '',
  total_amount NUMERIC(12,2) DEFAULT 0,
  pdf_url TEXT NOT NULL,
  pdf_size NUMERIC(12,0) DEFAULT 0,
  generated_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_created ON expense_reimbursements(created_at);

ALTER TABLE expense_reimbursements DISABLE ROW LEVEL SECURITY;

COMMIT;
