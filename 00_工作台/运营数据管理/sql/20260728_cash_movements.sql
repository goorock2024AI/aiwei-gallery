BEGIN;

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

ALTER TABLE cash_movements DISABLE ROW LEVEL SECURITY;

ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS cash_summary JSONB DEFAULT '{}';

INSERT INTO cash_movements (
  id, date, type, amount, source_type, source_id, account_channel,
  operator_id, operator_name, reason, notes, created_at
)
SELECT
  'cash_sale_revenue_' || r.id,
  r.date,
  'cash_sale',
  COALESCE(r.cash_amount, 0),
  'revenue',
  r.id,
  '',
  '',
  COALESCE(r.handler, ''),
  'legacy cash sale seed',
  'seeded from revenue.cash_amount; not counted as new revenue',
  COALESCE(r.created_at, NOW())
FROM revenue r
WHERE COALESCE(r.cash_amount, 0) > 0
ON CONFLICT (id) DO NOTHING;

INSERT INTO cash_movements (
  id, date, type, amount, source_type, source_id, account_channel,
  operator_id, operator_name, reason, notes, created_at
)
SELECT
  'cash_refund_revenue_' || r.id,
  r.date,
  'cash_refund',
  -LEAST(COALESCE(r.refund_amount, 0), COALESCE(r.cash_amount, 0)),
  'revenue',
  r.id,
  '',
  '',
  COALESCE(r.adjusted_by, r.handler, ''),
  COALESCE(NULLIF(r.adjustment_reason, ''), 'legacy cash refund seed'),
  'seeded from revenue.refund_amount',
  COALESCE(r.adjusted_at, r.created_at, NOW())
FROM revenue r
WHERE COALESCE(r.cash_amount, 0) > 0
  AND COALESCE(r.refund_amount, 0) > 0
ON CONFLICT (id) DO NOTHING;

INSERT INTO cash_movements (
  id, date, type, amount, source_type, source_id, account_channel,
  operator_id, operator_name, reason, notes, created_at
)
SELECT
  'cash_void_revenue_' || r.id,
  r.date,
  'cash_void',
  -GREATEST(COALESCE(r.cash_amount, 0) - COALESCE(r.refund_amount, 0), 0),
  'revenue',
  r.id,
  '',
  '',
  COALESCE(r.adjusted_by, r.handler, ''),
  COALESCE(NULLIF(r.adjustment_reason, ''), 'legacy cash void seed'),
  'seeded from voided revenue.cash_amount',
  COALESCE(r.adjusted_at, r.created_at, NOW())
FROM revenue r
WHERE COALESCE(r.cash_amount, 0) > 0
  AND COALESCE(r.status, U&'\6B63\5E38') = U&'\5DF2\4F5C\5E9F'
ON CONFLICT (id) DO NOTHING;

INSERT INTO cash_movements (
  id, date, type, amount, source_type, source_id, account_channel,
  operator_id, operator_name, reason, notes, created_at
)
SELECT
  'cash_sale_gallery_' || g.id,
  g.date,
  'cash_sale',
  GREATEST(COALESCE(g.price, 0) * COALESCE(NULLIF(g.sale_quantity, 0), 1) - COALESCE(g.commission, 0), 0),
  'gallery',
  g.id,
  '',
  '',
  COALESCE(g.handler, ''),
  'legacy gallery cash sale seed',
  'seeded from gallery_sales cash payment',
  COALESCE(g.created_at, NOW())
FROM gallery_sales g
WHERE g.payment_method = U&'\73B0\91D1'
  AND GREATEST(COALESCE(g.price, 0) * COALESCE(NULLIF(g.sale_quantity, 0), 1) - COALESCE(g.commission, 0), 0) > 0
ON CONFLICT (id) DO NOTHING;

INSERT INTO cash_movements (
  id, date, type, amount, source_type, source_id, account_channel,
  operator_id, operator_name, reason, notes, created_at
)
SELECT
  'cash_refund_gallery_' || g.id,
  g.date,
  'cash_refund',
  -LEAST(
    COALESCE(g.refund_amount, 0),
    GREATEST(COALESCE(g.price, 0) * COALESCE(NULLIF(g.sale_quantity, 0), 1) - COALESCE(g.commission, 0), 0)
  ),
  'gallery',
  g.id,
  '',
  '',
  COALESCE(g.adjusted_by, g.handler, ''),
  COALESCE(NULLIF(g.adjustment_reason, ''), 'legacy gallery cash refund seed'),
  'seeded from gallery_sales.refund_amount',
  COALESCE(g.adjusted_at, g.created_at, NOW())
FROM gallery_sales g
WHERE g.payment_method = U&'\73B0\91D1'
  AND COALESCE(g.refund_amount, 0) > 0
ON CONFLICT (id) DO NOTHING;

INSERT INTO cash_movements (
  id, date, type, amount, source_type, source_id, account_channel,
  operator_id, operator_name, reason, notes, created_at
)
SELECT
  'cash_void_gallery_' || g.id,
  g.date,
  'cash_void',
  -GREATEST(
    GREATEST(COALESCE(g.price, 0) * COALESCE(NULLIF(g.sale_quantity, 0), 1) - COALESCE(g.commission, 0), 0)
      - COALESCE(g.refund_amount, 0),
    0
  ),
  'gallery',
  g.id,
  '',
  '',
  COALESCE(g.adjusted_by, g.handler, ''),
  COALESCE(NULLIF(g.adjustment_reason, ''), 'legacy gallery cash void seed'),
  'seeded from voided gallery_sales cash payment',
  COALESCE(g.adjusted_at, g.created_at, NOW())
FROM gallery_sales g
WHERE g.payment_method = U&'\73B0\91D1'
  AND COALESCE(g.status, U&'\5DF2\552E\51FA') = U&'\5DF2\4F5C\5E9F'
ON CONFLICT (id) DO NOTHING;

COMMIT;
