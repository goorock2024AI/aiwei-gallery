BEGIN;
-- Restore the original receipt basis. Preserve all execution records and audit evidence.
DO $$ BEGIN
  IF to_regclass('public.business_cash_revenue_facts_v2') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE VIEW business_revenue_facts_v2 AS ' || pg_get_viewdef('public.business_cash_revenue_facts_v2'::regclass,true);
  END IF;
END $$;
DROP VIEW IF EXISTS business_cash_revenue_facts_v2;
COMMIT;
