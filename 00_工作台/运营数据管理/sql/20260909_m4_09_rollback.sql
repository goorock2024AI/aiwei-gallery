-- M4-09 rollback disables the workflow view while preserving batch audit data
-- and every applied record_business_links overlay for forensic review.

BEGIN;

DROP VIEW IF EXISTS governance_batch_summary_v2;

COMMIT;
