BEGIN;
CREATE TABLE IF NOT EXISTS operations_weekly_feedback (
 id UUID PRIMARY KEY, report_id TEXT NOT NULL REFERENCES operations_analysis_reports(id), action_index INTEGER NOT NULL CHECK(action_index BETWEEN 0 AND 2),
 detail JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS weekly_feedback_report_idx ON operations_weekly_feedback(report_id,action_index,created_at DESC);
CREATE TABLE IF NOT EXISTS operations_weekly_runs (
 id UUID PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES operations_analysis_packets(id), start_date TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','analyzed','reviewed','published')), analysis JSONB, reviewed_by TEXT, reviewed_at TIMESTAMPTZ,
 report_id TEXT REFERENCES operations_analysis_reports(id), created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS operations_weekly_events (
 id UUID PRIMARY KEY, run_id UUID REFERENCES operations_weekly_runs(id), kind TEXT NOT NULL, actor TEXT NOT NULL, detail JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS operations_weekly_outbox (
 id UUID PRIMARY KEY, start_date TEXT NOT NULL, report_id TEXT NOT NULL REFERENCES operations_analysis_reports(id),
 kind TEXT NOT NULL CHECK(kind IN ('initial','correction')), body TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','retry','failed','uncertain','suppressed')), attempts INTEGER NOT NULL DEFAULT 0,
 channel_hash TEXT, next_attempt_at TIMESTAMPTZ, last_code TEXT, accepted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(report_id), CHECK(attempts BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_initial_once_idx ON operations_weekly_outbox(start_date) WHERE kind='initial' AND state<>'suppressed';
CREATE TABLE IF NOT EXISTS operations_weekly_attempts (
 id UUID PRIMARY KEY, outbox_id UUID NOT NULL REFERENCES operations_weekly_outbox(id), attempt_number INTEGER NOT NULL,
 state TEXT NOT NULL, code TEXT, actor TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ, UNIQUE(outbox_id,attempt_number)
);
COMMENT ON TABLE operations_weekly_feedback IS 'Append-only human feedback. Executed is distinct from effective. No generic REST writes.';
COMMENT ON TABLE operations_weekly_outbox IS 'Published report text only. Unknown delivery blocks retry; accepted is interface acceptance, not member receipt. Do not delete on rollback.';
COMMIT;
