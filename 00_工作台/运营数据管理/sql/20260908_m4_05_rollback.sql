-- M4-05 rollback: remove read-only revenue attribution candidates and regex helper.
-- Revenue facts, rules and manual links remain unchanged.

BEGIN;
DROP VIEW IF EXISTS revenue_attribution_candidates_v2;
DROP FUNCTION IF EXISTS governance_safe_regex_match(TEXT,TEXT);
COMMIT;
