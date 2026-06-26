-- 空间使用表：新增租金类型字段
ALTER TABLE space_usage ADD COLUMN IF NOT EXISTS rental_type TEXT DEFAULT '付费';

-- 空间日程表：记录每个空间的详细使用日程（支持跨天）
CREATE TABLE IF NOT EXISTS space_schedule (
  id TEXT PRIMARY KEY,
  space_usage_id TEXT REFERENCES space_usage(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_space_schedule_date ON space_schedule(date);
ALTER TABLE space_schedule DISABLE ROW LEVEL SECURITY;
