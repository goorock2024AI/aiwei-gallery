BEGIN;

CREATE TABLE IF NOT EXISTS trial_run_issues (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  impact TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  fix_version TEXT NOT NULL DEFAULT '',
  fix_notes TEXT NOT NULL DEFAULT '',
  verification_result TEXT NOT NULL DEFAULT '',
  reported_by TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fixed_by TEXT NOT NULL DEFAULT '',
  fixed_at TIMESTAMPTZ,
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (severity IN ('P0','P1','P2','P3')),
  CHECK (status IN ('open','fixing','fixed','verified'))
);

CREATE INDEX IF NOT EXISTS idx_trial_run_issues_gate
  ON trial_run_issues(status,severity,reported_at DESC);

CREATE TABLE IF NOT EXISTS trial_run_issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES trial_run_issues(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (action IN ('create','assign','fix','verify','reopen'))
);

CREATE INDEX IF NOT EXISTS idx_trial_run_issue_events_issue
  ON trial_run_issue_events(issue_id,created_at,id);

CREATE OR REPLACE VIEW trial_run_issue_register_v2 AS
SELECT i.*,
  COALESCE((SELECT COUNT(*) FROM trial_run_issue_events e WHERE e.issue_id=i.id),0)::INTEGER AS event_count,
  COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'id',e.id,'action',e.action,'fromStatus',e.from_status,'toStatus',e.to_status,
    'actorId',e.actor_id,'actorName',e.actor_name,'details',e.details,'createdAt',e.created_at
  ) ORDER BY e.created_at,e.id) FROM trial_run_issue_events e WHERE e.issue_id=i.id),'[]'::JSONB) AS events
FROM trial_run_issues i;

ALTER TABLE trial_run_issues DISABLE ROW LEVEL SECURITY;
ALTER TABLE trial_run_issue_events DISABLE ROW LEVEL SECURITY;

COMMIT;
