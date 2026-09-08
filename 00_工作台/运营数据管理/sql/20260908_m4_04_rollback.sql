-- M4-04 rollback: remove product classification and cost evidence views.
-- Product master, aliases and historical sales remain unchanged.

BEGIN;
DROP VIEW IF EXISTS product_master_governance_v2;
DROP VIEW IF EXISTS product_cost_evidence_v2;
COMMIT;
