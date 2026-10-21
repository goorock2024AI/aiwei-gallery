BEGIN;
CREATE TABLE IF NOT EXISTS operations_daily_briefs (
 id UUID PRIMARY KEY, business_date TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 source_hash TEXT NOT NULL, payload JSONB NOT NULL, artifacts JSONB NOT NULL,
 supersedes UUID REFERENCES operations_daily_briefs(id), created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(business_date,revision)
);
CREATE INDEX IF NOT EXISTS daily_briefs_date_idx ON operations_daily_briefs(business_date,revision DESC);
CREATE TABLE IF NOT EXISTS operations_daily_dispatch (
 brief_id UUID NOT NULL REFERENCES operations_daily_briefs(id), channel_hash TEXT NOT NULL,
 part TEXT NOT NULL CHECK(part IN('text','image')), state TEXT NOT NULL CHECK(state IN('sending','accepted','retry','uncertain','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ, last_code TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(brief_id,channel_hash,part)
);
COMMENT ON TABLE operations_daily_dispatch IS 'Only official WeCom internal-group webhook. accepted means server accepted, not read. Uncertain results require operator review.';
COMMIT;
