BEGIN;

CREATE TABLE IF NOT EXISTS expense_attachments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expense(id) ON DELETE CASCADE,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('invoice', 'payment')),
  file_url TEXT NOT NULL,
  original_name TEXT DEFAULT '',
  file_size NUMERIC(12,0) DEFAULT 0,
  mime_type TEXT DEFAULT '',
  uploaded_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense_id ON expense_attachments(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_type ON expense_attachments(attachment_type);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_created ON expense_attachments(created_at);

ALTER TABLE expense_attachments DISABLE ROW LEVEL SECURITY;

COMMIT;
