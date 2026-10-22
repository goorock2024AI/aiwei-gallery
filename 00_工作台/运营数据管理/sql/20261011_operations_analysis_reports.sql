BEGIN;
CREATE TABLE IF NOT EXISTS operations_analysis_packets (
 id TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 compare_start TEXT NOT NULL, compare_end TEXT NOT NULL,
 sha256 TEXT NOT NULL, payload JSONB NOT NULL, created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS operations_analysis_reports (
 id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES operations_analysis_packets(id),
 title TEXT NOT NULL, summary TEXT NOT NULL, content JSONB NOT NULL,
 published_by TEXT NOT NULL, published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operations_reports_published_idx ON operations_analysis_reports(published_at DESC);
COMMIT;
