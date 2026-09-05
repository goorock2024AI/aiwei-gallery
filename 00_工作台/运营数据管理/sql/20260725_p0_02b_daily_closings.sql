BEGIN;

CREATE TABLE IF NOT EXISTS daily_closings (
  id TEXT PRIMARY KEY,
  date TEXT UNIQUE NOT NULL,
  system_net_amount NUMERIC(12,2) DEFAULT 0,
  confirmed_amount NUMERIC(12,2) DEFAULT 0,
  difference_amount NUMERIC(12,2) DEFAULT 0,
  revenue_summary JSONB DEFAULT '{}',
  payment_summary JSONB DEFAULT '{}',
  expense_summary JSONB DEFAULT '{}',
  adjustment_summary JSONB DEFAULT '{}',
  closer_id TEXT DEFAULT '',
  closer_name TEXT DEFAULT '',
  reviewer_name TEXT DEFAULT '',
  status TEXT DEFAULT '草稿',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_closings_date ON daily_closings(date);
ALTER TABLE daily_closings DISABLE ROW LEVEL SECURITY;

COMMIT;

SELECT 'daily_closings' AS object_name, COUNT(*) AS rows FROM daily_closings;
