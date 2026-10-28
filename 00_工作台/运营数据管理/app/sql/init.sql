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
  status TEXT DEFAULT '正常',
  refund_amount NUMERIC(12,2) DEFAULT 0,
  adjusted_at TIMESTAMPTZ,
  adjusted_by TEXT DEFAULT '',
  adjustment_reason TEXT DEFAULT '',
  artwork_id TEXT,
  settlement_price_snapshot NUMERIC(12,2) DEFAULT 0,
  retail_price_snapshot NUMERIC(12,2) DEFAULT 0,
  gross_amount_snapshot NUMERIC(12,2) DEFAULT 0,
  net_amount_snapshot NUMERIC(12,2) DEFAULT 0,
  gallery_channel TEXT DEFAULT '馆内画廊',
  business_type_code TEXT DEFAULT 'gallery_sale',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue(date);

-- 2. 支出表
CREATE TABLE IF NOT EXISTS expense (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT DEFAULT '运营支出',
  project TEXT DEFAULT '运营',
  category TEXT DEFAULT '材料',
  amount NUMERIC(12,2) DEFAULT 0,
  description TEXT DEFAULT '',
  handler TEXT DEFAULT '',
  invoice_status TEXT DEFAULT '待补',
  receipt_status TEXT DEFAULT '待补',
  reimbursement_status TEXT DEFAULT '未报销',
  related_activity TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense(date);

CREATE TABLE IF NOT EXISTS expense_attachments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expense(id) ON DELETE CASCADE,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('invoice', 'payment')),
  file_url TEXT NOT NULL,
  original_name TEXT DEFAULT '',
  file_size NUMERIC(12,0) DEFAULT 0,
  mime_type TEXT DEFAULT '',
  uploaded_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense_id ON expense_attachments(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_type ON expense_attachments(attachment_type);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_created ON expense_attachments(created_at);

CREATE TABLE IF NOT EXISTS expense_reimbursements (
  id TEXT PRIMARY KEY,
  expense_ids JSONB NOT NULL DEFAULT '[]',
  title TEXT DEFAULT '',
  total_amount NUMERIC(12,2) DEFAULT 0,
  pdf_url TEXT NOT NULL,
  pdf_size NUMERIC(12,0) DEFAULT 0,
  generated_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_created ON expense_reimbursements(created_at);

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
  business_layer_code TEXT DEFAULT 'art_transaction_cooperation',
  business_type_code TEXT DEFAULT '',
  cooperation_mode TEXT DEFAULT '',
  project_owner TEXT DEFAULT '',
  contract_no TEXT DEFAULT '',
  business_status TEXT DEFAULT '',
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
  ) AS received_amount,
  s.business_layer_code, s.business_type_code, s.cooperation_mode,
  s.project_owner, s.contract_no, s.business_status
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
  refund_amount NUMERIC(12,2) DEFAULT 0,
  adjusted_at TIMESTAMPTZ,
  adjusted_by TEXT DEFAULT '',
  adjustment_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gallery_sales_date ON gallery_sales(date);
CREATE INDEX IF NOT EXISTS idx_gallery_sales_artwork_no ON gallery_sales(artwork_no) WHERE artwork_no <> '';
CREATE INDEX IF NOT EXISTS idx_gallery_sales_artwork_id ON gallery_sales(artwork_id) WHERE artwork_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transaction_adjustments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  amount NUMERIC(12,2) DEFAULT 0,
  reason TEXT DEFAULT '',
  operator_id TEXT DEFAULT '',
  operator_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transaction_adjustments_target ON transaction_adjustments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_transaction_adjustments_created ON transaction_adjustments(created_at);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(12,2) DEFAULT 0,
  source_type TEXT DEFAULT '',
  source_id TEXT DEFAULT '',
  account_channel TEXT DEFAULT '',
  operator_id TEXT DEFAULT '',
  operator_name TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(date);
CREATE INDEX IF NOT EXISTS idx_cash_movements_source ON cash_movements(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_created ON cash_movements(created_at);

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
  cash_summary JSONB DEFAULT '{}',
  closer_id TEXT DEFAULT '',
  closer_name TEXT DEFAULT '',
  reviewer_name TEXT DEFAULT '',
  status TEXT DEFAULT '草稿',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_closings_date ON daily_closings(date);

-- 4.1 统一收入事实视图（P0-01）
-- 只读口径：把 POS 收入、画廊销售净收入、空间实际到款统一为一张事实表。
-- 空间收入按 payment_date 入账，避免按项目开始日期重复计入。
CREATE OR REPLACE VIEW revenue_facts AS
SELECT
  r.id || ':ticket' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '门票' AS category,
  r.ticket_amount AS amount,
  r.ticket_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.ticket_amount, 0) <> 0
UNION ALL
SELECT
  r.id || ':combo' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '咖啡套票' AS category,
  r.combo_amount AS amount,
  r.combo_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.combo_amount, 0) <> 0
UNION ALL
SELECT
  r.id || ':coffee' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '咖啡' AS category,
  r.coffee_amount AS amount,
  r.coffee_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.coffee_amount, 0) <> 0
UNION ALL
SELECT
  r.id || ':workshop' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '工坊' AS category,
  r.workshop_amount AS amount,
  r.workshop_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.workshop_amount, 0) <> 0
UNION ALL
SELECT
  r.id || ':retail' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '文创' AS category,
  COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) AS amount,
  COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) <> 0
UNION ALL
SELECT
  r.id || ':venue_legacy' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '场地旧口径' AS category,
  r.venue_amount AS amount,
  r.venue_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.venue_amount, 0) <> 0
UNION ALL
SELECT
  r.id || ':other' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  '其他' AS category,
  r.other_amount AS amount,
  r.other_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.status, '正常') <> '已作废'
  AND COALESCE(r.other_amount, 0) <> 0
UNION ALL
SELECT
  g.id || ':gallery' AS id,
  g.id AS record_id,
  g.date,
  'gallery' AS source,
  '画廊' AS category,
  g.price AS amount,
  COALESCE(g.price, 0) - COALESCE(g.commission, 0) AS net_amount,
  g.payment_method,
  g.related_exhibition AS project_name,
  g.handler,
  g.created_at
FROM gallery_sales g
WHERE COALESCE(g.status, '已售出') <> '已作废'
  AND COALESCE(g.price, 0) <> 0
UNION ALL
SELECT
  p.id || ':space' AS id,
  p.id AS record_id,
  p.payment_date AS date,
  'space' AS source,
  '场地' AS category,
  p.amount AS amount,
  p.amount AS net_amount,
  p.payment_method,
  s.project_name,
  '' AS handler,
  p.created_at
FROM space_payments p
JOIN space_usage s ON s.id = p.space_usage_id
WHERE s.rental_type = '付费' AND COALESCE(p.amount, 0) <> 0
UNION ALL
SELECT
  a.id || ':adjustment' AS id,
  a.target_id AS record_id,
  TO_CHAR(a.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date,
  a.target_type AS source,
  CASE
    WHEN a.action = 'refund' THEN '退款'
    WHEN a.action = 'partial_refund' THEN '部分退款'
    ELSE '调整'
  END AS category,
  -ABS(a.amount) AS amount,
  -ABS(a.amount) AS net_amount,
  '' AS payment_method,
  '' AS project_name,
  a.operator_name AS handler,
  a.created_at
FROM transaction_adjustments a
WHERE a.action IN ('refund', 'partial_refund')
  AND COALESCE(a.amount, 0) <> 0;

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
  approval_status TEXT DEFAULT '已上架',
  submitted_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
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
  standard_name TEXT DEFAULT '',
  business_type_code TEXT DEFAULT '',
  package_spec TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  is_beverage BOOLEAN DEFAULT false,
  is_countable_stock BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  sku TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  cost_price NUMERIC(10,2) DEFAULT 0,
  retail_price NUMERIC(10,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  unit TEXT DEFAULT '个',
  approval_status TEXT DEFAULT '已上架',
  submitted_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. 2.0 试运行问题台账与复验事件
CREATE TABLE IF NOT EXISTS trial_run_issues (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  title TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  impact TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixing','fixed','verified')),
  fix_version TEXT NOT NULL DEFAULT '',
  fix_notes TEXT NOT NULL DEFAULT '',
  verification_result TEXT NOT NULL DEFAULT '',
  reported_by TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fixed_by TEXT NOT NULL DEFAULT '',
  fixed_at TIMESTAMPTZ,
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trial_run_issues_gate ON trial_run_issues(status,severity,reported_at DESC);

CREATE TABLE IF NOT EXISTS trial_run_issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES trial_run_issues(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('create','assign','fix','verify','reopen')),
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trial_run_issue_events_issue ON trial_run_issue_events(issue_id,created_at,id);

CREATE OR REPLACE VIEW trial_run_issue_register_v2 AS
SELECT i.*,
  COALESCE((SELECT COUNT(*) FROM trial_run_issue_events e WHERE e.issue_id=i.id),0)::INTEGER AS event_count,
  COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'id',e.id,'action',e.action,'fromStatus',e.from_status,'toStatus',e.to_status,
    'actorId',e.actor_id,'actorName',e.actor_name,'details',e.details,'createdAt',e.created_at
  ) ORDER BY e.created_at,e.id) FROM trial_run_issue_events e WHERE e.issue_id=i.id),'[]'::JSONB) AS events
FROM trial_run_issues i;

-- 关闭 RLS（兼容当前认证方案）
ALTER TABLE revenue DISABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_adjustments DISABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_closings DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense_reimbursements DISABLE ROW LEVEL SECURITY;
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
ALTER TABLE trial_run_issues DISABLE ROW LEVEL SECURITY;
ALTER TABLE trial_run_issue_events DISABLE ROW LEVEL SECURITY;

-- 种子配置数据
INSERT INTO app_config (key, value) VALUES
('ticket_products', '[{"name":"普通票","costPrice":0,"price":10},{"name":"套票","costPrice":0,"price":25}]'),
('coffee_products', '[{"name":"手冲咖啡","costPrice":0,"price":15}]'),
('workshop_products', '[{"name":"果壳风铃","costPrice":0,"price":128},{"name":"豆荚娃娃","costPrice":0,"price":118},{"name":"迷你冰箱贴","costPrice":0,"price":35},{"name":"木刻杯垫","costPrice":0,"price":88},{"name":"A5木刻","costPrice":0,"price":168},{"name":"A4木刻","costPrice":0,"price":198},{"name":"拓印体验","costPrice":0,"price":38}]'),
('spaces', '[{"name":"1号厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"2号厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"美学空间","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"多功能厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"六楼综合空间","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"走廊画廊","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"户外露台","dailyPrice":0,"halfDayPrice":0,"desc":""}]'),
('operations_rollout', '{"mode":"off"}')
ON CONFLICT (key) DO NOTHING;

-- 默认管理员（密码: <redacted-admin-password>）
INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES
('usr_admin_init', 'admin', '管理员', '__need_change__:9f6e6800cfae7749eb6c8036192359176c43e0f113492473ac8c9535bdb7e7f8', 'admin', true)
ON CONFLICT (username) DO NOTHING;

-- UAT-04 retail stock accounting
-- Prospective stock accounting: existing sales are baselines, never back-deducted.
BEGIN;
-- Freeze sale writes while capturing the historical baseline and enabling the trigger.
LOCK TABLE revenue IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS retail_stock_balances (
 revenue_id TEXT NOT NULL, product_id TEXT NOT NULL,
 baseline_qty INTEGER NOT NULL DEFAULT 0, current_qty INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(revenue_id,product_id)
);
CREATE TABLE IF NOT EXISTS retail_stock_movements (
 id BIGSERIAL PRIMARY KEY, revenue_id TEXT NOT NULL, product_id TEXT NOT NULL,
 quantity_delta INTEGER NOT NULL, stock_before INTEGER NOT NULL, stock_after INTEGER NOT NULL,
 actor_id TEXT, action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION retail_stock_quantities(items JSONB)
RETURNS TABLE(product_id TEXT, qty INTEGER) LANGUAGE plpgsql AS $$
DECLARE item JSONB; identity TEXT; amount NUMERIC;
BEGIN
 IF items IS NULL OR items = 'null'::jsonb OR items = '{}'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(items) <> 'array' THEN RAISE EXCEPTION '零售明细必须为数组'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  identity := COALESCE(item->>'productId',item->>'product_id');
  IF identity IS NULL OR identity = '' THEN CONTINUE; END IF;
  IF COALESCE(item->>'isCountableStock',item->>'is_countable_stock','true') = 'false' THEN CONTINUE; END IF;
  amount := COALESCE(item->>'qty',item->>'quantity','0')::NUMERIC;
  IF amount < 0 OR amount <> trunc(amount) OR amount > 2147483647 THEN
   RAISE EXCEPTION '计库存商品销售数量必须为非负整数';
  END IF;
  product_id := identity; qty := amount::INTEGER; RETURN NEXT;
 END LOOP;
END $$;
-- Only on first installation. Replaying this migration must not reset tracked balances.
INSERT INTO retail_stock_balances(revenue_id,product_id,baseline_qty,current_qty)
SELECT r.id,q.product_id,sum(q.qty)::INTEGER,sum(q.qty)::INTEGER
FROM revenue r CROSS JOIN LATERAL retail_stock_quantities(r.retail_items) q
JOIN creative_products p ON p.id=q.product_id AND COALESCE(p.is_countable_stock,true)
GROUP BY r.id,q.product_id ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION apply_retail_stock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE sale_id TEXT; items JSONB; entry RECORD; target_qty INTEGER; delta INTEGER; previous_stock INTEGER;
BEGIN
 sale_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='UPDATE' AND NEW.id <> OLD.id THEN RAISE EXCEPTION '销售记录编号不可修改'; END IF;
 items := CASE WHEN TG_OP='DELETE' THEN '[]'::jsonb ELSE NEW.retail_items END;
 IF TG_OP <> 'DELETE' AND EXISTS (
  SELECT 1 FROM retail_stock_quantities(items) q LEFT JOIN creative_products p ON p.id=q.product_id WHERE p.id IS NULL
 ) THEN RAISE EXCEPTION '所选商品不存在，请刷新商品库'; END IF;
 -- Lock product rows in a consistent order, then reconcile the persisted sale balance.
 FOR entry IN
  SELECT p.id,COALESCE(p.is_countable_stock,true) counted,
   COALESCE(q.qty,0)::INTEGER desired
  FROM creative_products p LEFT JOIN
   (SELECT product_id,sum(qty)::INTEGER qty FROM retail_stock_quantities(items) GROUP BY product_id) q ON q.product_id=p.id
  WHERE q.product_id IS NOT NULL OR EXISTS
   (SELECT 1 FROM retail_stock_balances b WHERE b.revenue_id=sale_id AND b.product_id=p.id)
  ORDER BY p.id FOR UPDATE OF p
 LOOP
  INSERT INTO retail_stock_balances(revenue_id,product_id) VALUES(sale_id,entry.id) ON CONFLICT DO NOTHING;
  SELECT CASE WHEN TG_OP='DELETE' THEN baseline_qty
   WHEN entry.counted THEN entry.desired ELSE current_qty END - current_qty
   INTO delta FROM retail_stock_balances WHERE revenue_id=sale_id AND product_id=entry.id FOR UPDATE;
  IF delta <> 0 THEN
   SELECT COALESCE(stock,0) INTO previous_stock FROM creative_products WHERE id=entry.id;
   UPDATE creative_products SET stock=COALESCE(stock,0)-delta,updated_at=now() WHERE id=entry.id;
   INSERT INTO retail_stock_movements(revenue_id,product_id,quantity_delta,stock_before,stock_after,actor_id,action)
    VALUES(sale_id,entry.id,-delta,previous_stock,previous_stock-delta,
     NULLIF(current_setting('aiwei.actor_id',true),''),TG_OP);
   UPDATE retail_stock_balances SET current_qty=current_qty+delta WHERE revenue_id=sale_id AND product_id=entry.id;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN DELETE FROM retail_stock_balances WHERE revenue_id=sale_id; RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS revenue_retail_stock ON revenue;
CREATE TRIGGER revenue_retail_stock AFTER INSERT OR UPDATE OR DELETE ON revenue
 FOR EACH ROW EXECUTE FUNCTION apply_retail_stock();
COMMIT;

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

BEGIN;
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS supersedes_id TEXT;
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS superseded_by_id TEXT;
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS revision_reason TEXT DEFAULT '';
ALTER TABLE expense_reimbursements ADD COLUMN IF NOT EXISTS snapshot JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS expense_pdf_one_successor ON expense_reimbursements(supersedes_id) WHERE supersedes_id IS NOT NULL;
COMMIT;

-- COFFEE-20261021 dedicated inventory API tables
BEGIN;
CREATE TABLE IF NOT EXISTS coffee_inventory_state (
  id TEXT PRIMARY KEY CHECK (id = 'coffee'),
  version INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO coffee_inventory_state(id) VALUES ('coffee') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS coffee_inventory_events (
  request_id UUID PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  state_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE coffee_inventory_events IS '咖啡库存专用API事务审计；不开放通用REST写入，不删除历史';
COMMIT;

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

-- Space project workflow and private contract snapshots 20261025
CREATE TABLE IF NOT EXISTS space_project_workflows (
 space_usage_id TEXT PRIMARY KEY REFERENCES space_usage(id) ON DELETE RESTRICT,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS space_contract_documents (
 id TEXT PRIMARY KEY, space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL, template_version TEXT NOT NULL, snapshot JSONB NOT NULL,
 source_version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(space_usage_id,revision)
);
CREATE TABLE IF NOT EXISTS space_project_expenses (
 space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
 expense_id TEXT NOT NULL UNIQUE REFERENCES expense(id) ON DELETE RESTRICT,
 linked_by TEXT NOT NULL, linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(space_usage_id,expense_id)
);
CREATE TABLE IF NOT EXISTS space_project_workflow_events (
 id TEXT PRIMARY KEY,space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
 action TEXT NOT NULL,version INTEGER NOT NULL,before_payload JSONB,after_payload JSONB NOT NULL,
 actor_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

BEGIN;
-- Additive metadata only: original projects, receipts and income views remain intact.
CREATE TABLE IF NOT EXISTS space_quick_rentals (
 space_usage_id TEXT PRIMARY KEY REFERENCES space_usage(id) ON DELETE RESTRICT,
 mode TEXT NOT NULL DEFAULT 'simple' CHECK(mode IN ('simple','full')),
 start_at TEXT NOT NULL CHECK(start_at ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
 end_at TEXT NOT NULL CHECK(end_at ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_at>start_at),
 client_contact TEXT NOT NULL DEFAULT '',client_phone TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),initial_request_hash TEXT NOT NULL,
 completed_at TIMESTAMPTZ,converted_at TIMESTAMPTZ,
 created_by TEXT NOT NULL,updated_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
