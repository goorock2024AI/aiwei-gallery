-- Keep revision links and snapshots: dropping them would reactivate replaced packages.
-- Roll back the API/UI together; retain these additive columns and every PDF/audit row.
BEGIN;
SELECT 1;
COMMIT;
