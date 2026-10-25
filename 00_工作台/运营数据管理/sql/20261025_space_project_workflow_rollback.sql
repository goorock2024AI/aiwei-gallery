BEGIN;
-- Restore only the prior read model. New project/document/evidence records are retained.
DO $$ BEGIN
 IF to_regclass('public.space_project_performance_before_workflow') IS NOT NULL THEN
  EXECUTE 'CREATE OR REPLACE VIEW space_project_performance_v2 AS '||pg_get_viewdef('public.space_project_performance_before_workflow'::regclass,true);
  DROP VIEW space_project_performance_before_workflow;
 END IF;
END $$;
COMMIT;
