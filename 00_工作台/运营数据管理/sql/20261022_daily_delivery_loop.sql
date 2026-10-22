BEGIN;
CREATE TABLE IF NOT EXISTS operations_daily_outbox (
 id UUID PRIMARY KEY, business_date TEXT NOT NULL, channel_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('initial','correction')), sequence INTEGER NOT NULL,
 brief_id UUID NOT NULL REFERENCES operations_daily_briefs(id), baseline_id UUID REFERENCES operations_daily_briefs(id),
 body TEXT NOT NULL, comparison JSONB NOT NULL DEFAULT '{}',
 state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','retry','uncertain','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ, last_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), accepted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(business_date,channel_hash,kind,sequence),
 CHECK((kind='initial' AND sequence=0) OR (kind='correction' AND sequence>0))
);
CREATE TABLE IF NOT EXISTS operations_daily_followup (
 business_date TEXT PRIMARY KEY, detail JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS operations_daily_attempts (
 id UUID PRIMARY KEY, outbox_id UUID NOT NULL REFERENCES operations_daily_outbox(id),
 attempt_number INTEGER NOT NULL, started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
 state TEXT NOT NULL, code TEXT, UNIQUE(outbox_id,attempt_number)
);
CREATE TABLE IF NOT EXISTS operations_daily_incidents (
 id UUID PRIMARY KEY, business_date TEXT NOT NULL, code TEXT NOT NULL, detail JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
 reminder_state TEXT NOT NULL DEFAULT 'channel_unconfigured',
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ,
 UNIQUE(business_date,code)
);
CREATE INDEX IF NOT EXISTS daily_incidents_open_idx ON operations_daily_incidents(state,business_date DESC);
COMMENT ON TABLE operations_daily_outbox IS 'One initial text per date/channel. Independent correction sequences. accepted is API acceptance only; uncertain must not be retried automatically.';
COMMIT;
