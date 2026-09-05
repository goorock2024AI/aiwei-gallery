BEGIN;

ALTER TABLE expense
  ADD COLUMN IF NOT EXISTS reimbursement_status TEXT DEFAULT '未报销';

UPDATE expense
SET reimbursement_status = '未报销'
WHERE reimbursement_status IS NULL OR reimbursement_status = '';

COMMIT;

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'expense'
  AND column_name = 'reimbursement_status';

SELECT reimbursement_status, COUNT(*)
FROM expense
GROUP BY reimbursement_status
ORDER BY reimbursement_status;
