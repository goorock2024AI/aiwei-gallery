-- 艾维美术馆运营数据管理系统 · 数据库初始化
-- 用于 Docker 首次启动时自动建表

-- 1. 收入表
CREATE TABLE IF NOT EXISTS revenue (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  ticket_qty INTEGER DEFAULT 0,
  ticket_amount NUMERIC(12,2) DEFAULT 0,
  combo_qty INTEGER DEFAULT 0,
  combo_amount NUMERIC(12,2) DEFAULT 0,
  coffee_qty INTEGER DEFAULT 0,
  coffee_amount NUMERIC(12,2) DEFAULT 0,
  ticket_items JSONB DEFAULT '[]',
  coffee_items JSONB DEFAULT '[]',
  workshop_items JSONB DEFAULT '[]',
  workshop_amount NUMERIC(12,2) DEFAULT 0,
  retail_items JSONB DEFAULT '[]',
  retail_amount NUMERIC(12,2) DEFAULT 0,
  creative_amount NUMERIC(12,2) DEFAULT 0,
  venue_amount NUMERIC(12,2) DEFAULT 0,
  other_amount NUMERIC(12,2) DEFAULT 0,
  other_desc TEXT DEFAULT '',
  cash_amount NUMERIC(12,2) DEFAULT 0,
  account_amount NUMERIC(12,2) DEFAULT 0,
  payment_method TEXT DEFAULT '扫码支付',
  project_name TEXT DEFAULT '',
  handler TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue(date);

-- 2. 支出表
CREATE TABLE IF NOT EXISTS expense (
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
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense(date);

-- 3. 空间使用表（重构 2026-07-10：加 expected_payment_date；received_amount 由 space_payments 子表聚合）
CREATE TABLE IF NOT EXISTS space_usage (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  end_date TEXT DEFAULT '',
  space TEXT DEFAULT '1号厅',
  project_name TEXT DEFAULT '',
  type TEXT DEFAULT '展览',
  client TEXT DEFAULT '',
  status TEXT DEFAULT '筹备中',
  rental_type TEXT DEFAULT '付费',
  receivable_amount NUMERIC(12,2) DEFAULT 0,
  expected_payment_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_space_usage_date ON space_usage(date);
CREATE INDEX IF NOT EXISTS idx_space_usage_expected ON space_usage(expected_payment_date);

-- 3.1 空间使用付款明细子表（重构 2026-07-10：一笔到账一条记录，支持分期）
CREATE TABLE IF NOT EXISTS space_payments (
  id TEXT PRIMARY KEY,
  space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount NUMERIC(12,2) DEFAULT 0,
  payment_method TEXT DEFAULT '转账',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_space_payments_usage ON space_payments(space_usage_id);
CREATE INDEX IF NOT EXISTS idx_space_payments_date  ON space_payments(payment_date);
ALTER TABLE space_payments DISABLE ROW LEVEL SECURITY;

-- 3.2 视图：前端一次拿全主表 + 子表聚合（带 payments JSON 数组 + receivedAmount）
-- 注意：列名用 received_amount 让视图与普通表列名一致，server.js toCamel 后统一得到 receivedAmount
CREATE OR REPLACE VIEW space_usage_with_payments AS
SELECT
  s.id, s.date, s.end_date, s.space, s.project_name, s.type, s.client,
  s.status, s.rental_type, s.receivable_amount, s.expected_payment_date,
  s.notes, s.created_at,
  COALESCE(
    (SELECT json_agg(json_build_object(
       'id', p.id,
       'paymentDate', p.payment_date,
       'amount', p.amount,
       'paymentMethod', p.payment_method,
       'notes', p.notes,
       'createdAt', p.created_at
     ) ORDER BY p.payment_date)
     FROM space_payments p WHERE p.space_usage_id = s.id),
    '[]'::json
  ) AS payments,
  COALESCE(
    (SELECT SUM(amount) FROM space_payments p WHERE p.space_usage_id = s.id),
    0
  ) AS received_amount
FROM space_usage s;

-- 4. 画廊销售表
CREATE TABLE IF NOT EXISTS gallery_sales (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  artwork_no TEXT DEFAULT '',
  artwork_name TEXT DEFAULT '',
  artist TEXT DEFAULT '',
  price NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  buyer_name TEXT DEFAULT '',
  payment_method TEXT DEFAULT '扫码支付',
  related_exhibition TEXT DEFAULT '',
  status TEXT DEFAULT '已售出',
  handler TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  sale_quantity INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gallery_sales_date ON gallery_sales(date);
CREATE INDEX IF NOT EXISTS idx_gallery_sales_artwork_no ON gallery_sales(artwork_no) WHERE artwork_no <> '';

-- 5. 应用配置表
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'editor',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 7. 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT DEFAULT '',
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at);

-- 8. 项目注册表
CREATE TABLE IF NOT EXISTS project_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  tags JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. 库存表
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  quantity INTEGER DEFAULT 0,
  unit TEXT DEFAULT '个',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. 艺术品表（重构 2026-07-10：加 image_url；2026-07-11：加 settlement_price / retail_price；2026-07-12：加 artwork_no + total_qty + sold_qty）
CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  artwork_no TEXT DEFAULT '',
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  year TEXT DEFAULT '',
  medium TEXT DEFAULT '',
  dimensions TEXT DEFAULT '',
  location TEXT DEFAULT '',
  status TEXT DEFAULT '在库',
  image_url TEXT DEFAULT '',
  settlement_price NUMERIC DEFAULT 0,
  retail_price NUMERIC DEFAULT 0,
  total_qty INTEGER DEFAULT 1,
  sold_qty INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS artworks_artwork_no_unique ON artworks(artwork_no) WHERE artwork_no <> '';

-- 11. 合作伙伴表
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. 内容发布表
CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT DEFAULT '',
  publish_date TEXT DEFAULT '',
  status TEXT DEFAULT '草稿',
  url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. 文创产品表
CREATE TABLE IF NOT EXISTS creative_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  cost_price NUMERIC(10,2) DEFAULT 0,
  retail_price NUMERIC(10,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  unit TEXT DEFAULT '个',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 关闭 RLS（兼容当前认证方案）
ALTER TABLE revenue DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense DISABLE ROW LEVEL SECURITY;
ALTER TABLE space_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE operation_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE project_registry DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE artworks DISABLE ROW LEVEL SECURITY;
ALTER TABLE partners DISABLE ROW LEVEL SECURITY;
ALTER TABLE content_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE creative_products DISABLE ROW LEVEL SECURITY;

-- 种子配置数据
INSERT INTO app_config (key, value) VALUES
('ticket_products', '[{"name":"普通票","price":10},{"name":"套票","price":25}]'),
('coffee_products', '[{"name":"手冲咖啡","price":15}]'),
('workshop_products', '[{"name":"果壳风铃","price":128},{"name":"豆荚娃娃","price":118},{"name":"迷你冰箱贴","price":35},{"name":"木刻杯垫","price":88},{"name":"A5木刻","price":168},{"name":"A4木刻","price":198},{"name":"拓印体验","price":38}]'),
('spaces', '[{"name":"1号厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"2号厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"美学空间","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"多功能厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"六楼综合空间","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"走廊画廊","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"户外露台","dailyPrice":0,"halfDayPrice":0,"desc":""}]')
ON CONFLICT (key) DO NOTHING;

-- 默认管理员（密码: admin888）
INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES
('usr_admin_init', 'admin', '管理员', '__need_change__:9f6e6800cfae7749eb6c8036192359176c43e0f113492473ac8c9535bdb7e7f8', 'admin', true)
ON CONFLICT (username) DO NOTHING;
