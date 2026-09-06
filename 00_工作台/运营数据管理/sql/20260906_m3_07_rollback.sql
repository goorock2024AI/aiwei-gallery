BEGIN;
DROP VIEW IF EXISTS gallery_transaction_performance_v2;
-- Additive transaction columns are intentionally retained to preserve sale and audit evidence.
COMMIT;
