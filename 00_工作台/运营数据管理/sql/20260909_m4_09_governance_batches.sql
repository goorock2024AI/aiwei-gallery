-- M4-09: governed batch workflow for reversible business attribution links.
-- Operational source facts are never updated by this migration or workflow.

BEGIN;

CREATE TABLE IF NOT EXISTS governance_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'business_attribution',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  dry_run_summary JSONB DEFAULT '{}'::JSONB,
  dry_run_at TIMESTAMPTZ,
  submitted_by TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ,
  reviewed_by TEXT DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  review_note TEXT DEFAULT '',
  applied_by TEXT DEFAULT '',
  applied_at TIMESTAMPTZ,
  reverted_by TEXT DEFAULT '',
  reverted_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('draft','pending_review','approved','rejected','applied','reverted')),
  CHECK (scope IN ('business_attribution'))
);

CREATE TABLE IF NOT EXISTS governance_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES governance_batches(id) ON DELETE RESTRICT,
  sequence_no INTEGER NOT NULL,
  candidate_type TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_line_key TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'record_business_link',
  before_payload JSONB,
  proposed_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  applied_payload JSONB,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  affected_amount NUMERIC(14,2) DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (batch_id, candidate_id),
  UNIQUE (batch_id, source_table, source_id, source_line_key),
  CHECK (candidate_type IN ('revenue_attribution','cost_attribution')),
  CHECK (target_type='record_business_link'),
  CHECK (validation_status IN ('pending','valid','invalid','applied','reverted'))
);

CREATE INDEX IF NOT EXISTS idx_governance_batch_items_batch
  ON governance_batch_items(batch_id,sequence_no);

CREATE TABLE IF NOT EXISTS governance_batch_events (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES governance_batches(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT DEFAULT '',
  actor_id TEXT NOT NULL,
  actor_name TEXT DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (action IN ('create','dry_run','submit','approve','reject','apply','revert'))
);

CREATE INDEX IF NOT EXISTS idx_governance_batch_events_batch
  ON governance_batch_events(batch_id,created_at,id);

CREATE OR REPLACE VIEW governance_batch_summary_v2 AS
SELECT b.*,
  COALESCE((SELECT COUNT(*) FROM governance_batch_items i WHERE i.batch_id=b.id),0)::INTEGER AS item_count,
  COALESCE((SELECT COUNT(*) FROM governance_batch_items i WHERE i.batch_id=b.id AND i.validation_status IN ('valid','applied','reverted')),0)::INTEGER AS valid_item_count,
  COALESCE((SELECT COUNT(*) FROM governance_batch_items i WHERE i.batch_id=b.id AND i.validation_status='invalid'),0)::INTEGER AS invalid_item_count,
  COALESCE((SELECT SUM(i.affected_amount) FROM governance_batch_items i WHERE i.batch_id=b.id),0)::NUMERIC AS affected_amount,
  COALESCE((SELECT COUNT(*) FROM governance_batch_events e WHERE e.batch_id=b.id),0)::INTEGER AS event_count,
  COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'id',i.id,'sequenceNo',i.sequence_no,'candidateType',i.candidate_type,'candidateId',i.candidate_id,
    'sourceTable',i.source_table,'sourceId',i.source_id,'sourceLineKey',i.source_line_key,
    'targetType',i.target_type,'beforePayload',i.before_payload,'proposedPayload',i.proposed_payload,
    'appliedPayload',i.applied_payload,'validationStatus',i.validation_status,
    'validationErrors',i.validation_errors,'affectedAmount',i.affected_amount,'note',i.note
  ) ORDER BY i.sequence_no) FROM governance_batch_items i WHERE i.batch_id=b.id),'[]'::JSONB) AS items,
  COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'id',e.id,'action',e.action,'fromStatus',e.from_status,'toStatus',e.to_status,
    'actorId',e.actor_id,'actorName',e.actor_name,'details',e.details,'createdAt',e.created_at
  ) ORDER BY e.created_at,e.id) FROM governance_batch_events e WHERE e.batch_id=b.id),'[]'::JSONB) AS events
FROM governance_batches b;

ALTER TABLE governance_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE governance_batch_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE governance_batch_events DISABLE ROW LEVEL SECURITY;

COMMIT;
