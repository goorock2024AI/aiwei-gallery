-- 艾维美术馆运营数据管理系统 - 数据库初始化
-- 注意：使用 snake_case 字段名，store.js 会自动与 JS camelCase 互转

-- 先删除旧表（因为用错了字段名）
DROP TABLE IF EXISTS revenue CASCADE;
DROP TABLE IF EXISTS expense CASCADE;
DROP TABLE IF EXISTS space_usage CASCADE;

-- 1. 收入表
CREATE TABLE revenue (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  ticket_qty INTEGER DEFAULT 0,
  ticket_amount NUMERIC(12,2) DEFAULT 0,
  coffee_qty INTEGER DEFAULT 0,
  coffee_amount NUMERIC(12,2) DEFAULT 0,
  workshop_items JSONB DEFAULT '[]',
  workshop_amount NUMERIC(12,2) DEFAULT 0,
  creative_amount NUMERIC(12,2) DEFAULT 0,
  venue_amount NUMERIC(12,2) DEFAULT 0,
  other_amount NUMERIC(12,2) DEFAULT 0,
  other_desc TEXT DEFAULT '',
  cash_amount NUMERIC(12,2) DEFAULT 0,
  account_amount NUMERIC(12,2) DEFAULT 0,
  project_name TEXT DEFAULT '',
  handler TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_revenue_date ON revenue(date);

-- 2. 支出表
CREATE TABLE expense (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT DEFAULT '备用金支出',
  project TEXT DEFAULT '运营',
  category TEXT DEFAULT '材料',
  amount NUMERIC(12,2) DEFAULT 0,
  description TEXT DEFAULT '',
  handler TEXT DEFAULT '',
  invoice_status TEXT DEFAULT '待补',
  receipt_status TEXT DEFAULT '待补',
  related_activity TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_expense_date ON expense(date);

-- 3. 空间使用表
CREATE TABLE space_usage (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  space TEXT DEFAULT '1号厅',
  project_name TEXT DEFAULT '',
  type TEXT DEFAULT '展览',
  client TEXT DEFAULT '',
  status TEXT DEFAULT '筹备中',
  receivable_amount NUMERIC(12,2) DEFAULT 0,
  received_amount NUMERIC(12,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_space_usage_date ON space_usage(date);

-- 关闭 RLS
ALTER TABLE revenue DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense DISABLE ROW LEVEL SECURITY;
ALTER TABLE space_usage DISABLE ROW LEVEL SECURITY;

-- 验证
SELECT 'revenue' AS table_name, count(*)::int AS row_count FROM revenue
UNION ALL
SELECT 'expense', count(*) FROM expense
UNION ALL
SELECT 'space_usage', count(*) FROM space_usage;
