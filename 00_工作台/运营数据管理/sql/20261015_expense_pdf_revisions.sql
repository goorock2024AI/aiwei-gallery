BEGIN;
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS supersedes_id TEXT;
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS superseded_by_id TEXT;
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS revision_reason TEXT DEFAULT '';
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS snapshot JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS expense_pdf_one_successor ON expense_reimbursements(supersedes_id) WHERE supersedes_id IS NOT NULL;
COMMIT;
