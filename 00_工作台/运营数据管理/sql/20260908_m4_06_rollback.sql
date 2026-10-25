-- M4-06 rollback removes only the read-only candidate view.

BEGIN;

DROP VIEW IF EXISTS cost_attribution_candidates_v2;
DROP FUNCTION IF EXISTS governance_safe_expense_regex_match(TEXT,TEXT);

COMMIT;
