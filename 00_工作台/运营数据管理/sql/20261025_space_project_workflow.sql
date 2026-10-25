BEGIN;
CREATE TABLE IF NOT EXISTS space_project_workflows (
 space_usage_id TEXT PRIMARY KEY REFERENCES space_usage(id) ON DELETE RESTRICT,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS space_contract_documents (
 id TEXT PRIMARY KEY, space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL, template_version TEXT NOT NULL, snapshot JSONB NOT NULL,
 source_version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(space_usage_id,revision)
);
CREATE TABLE IF NOT EXISTS space_project_expenses (
 space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
 expense_id TEXT NOT NULL UNIQUE REFERENCES expense(id) ON DELETE RESTRICT,
 linked_by TEXT NOT NULL, linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(space_usage_id,expense_id)
);
CREATE TABLE IF NOT EXISTS space_project_workflow_events (
 id TEXT PRIMARY KEY,space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
 action TEXT NOT NULL,version INTEGER NOT NULL,before_payload JSONB,after_payload JSONB NOT NULL,
 actor_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
 IF to_regclass('public.space_project_performance_before_workflow') IS NULL THEN
  EXECUTE 'CREATE VIEW space_project_performance_before_workflow AS '||pg_get_viewdef('public.space_project_performance_v2'::regclass,true);
 END IF;
END $$;
CREATE OR REPLACE VIEW space_project_performance_v2 AS
 SELECT id,start_date,end_date,space,project_name,client,execution_type,business_type_code,
 cooperation_mode,project_owner,contract_no,business_status,rental_type,
 CASE WHEN business_status IN ('线索','洽谈','待签署','暂缓','未成交','待确认') AND id IN (SELECT id FROM space_usage WHERE COALESCE(business_status,'')<>'') THEN 0::numeric ELSE receivable_amount END::NUMERIC(12,2) AS receivable_amount,
 received_amount,
 CASE WHEN business_status IN ('线索','洽谈','待签署','暂缓','未成交','待确认') AND id IN (SELECT id FROM space_usage WHERE COALESCE(business_status,'')<>'') THEN 0::numeric ELSE outstanding_amount END AS outstanding_amount,
 payment_count,first_payment_date,latest_payment_date,
 CASE WHEN business_status IN ('线索','洽谈','待签署','暂缓','未成交','待确认') AND id IN (SELECT id FROM space_usage WHERE COALESCE(business_status,'')<>'') THEN ''::text ELSE expected_payment_date END AS expected_payment_date,
 created_at
 FROM space_project_performance_before_workflow;
COMMIT;
