BEGIN;

ALTER TABLE revenue
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '正常',
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adjusted_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT DEFAULT '';

ALTER TABLE gallery_sales
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adjusted_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT DEFAULT '';

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

CREATE INDEX IF NOT EXISTS idx_transaction_adjustments_target
  ON transaction_adjustments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_transaction_adjustments_created
  ON transaction_adjustments(created_at);

ALTER TABLE transaction_adjustments DISABLE ROW LEVEL SECURITY;

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
WHERE s.rental_type = '付费'
  AND COALESCE(p.amount, 0) <> 0
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

COMMIT;

SELECT 'transaction_adjustments' AS object_name, COUNT(*) AS rows FROM transaction_adjustments;
SELECT source, category, COUNT(*) AS rows
FROM revenue_facts
GROUP BY source, category
ORDER BY source, category;
