BEGIN;

ALTER TABLE gallery_sales
  ADD COLUMN IF NOT EXISTS artwork_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_price_snapshot NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retail_price_snapshot NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_amount_snapshot NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_snapshot NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gallery_channel TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_type_code TEXT DEFAULT 'gallery_sale';

CREATE INDEX IF NOT EXISTS idx_gallery_sales_artwork_id ON gallery_sales(artwork_id) WHERE artwork_id <> '';

CREATE OR REPLACE VIEW gallery_transaction_performance_v2 AS
SELECT
  g.id,
  g.date AS business_date,
  g.artwork_id,
  g.artwork_no,
  g.artwork_name,
  g.artist,
  g.sale_quantity,
  g.gross_amount_snapshot AS gross_amount,
  g.settlement_price_snapshot * g.sale_quantity AS settlement_cost,
  g.commission,
  g.refund_amount,
  GREATEST(0, g.net_amount_snapshot - COALESCE(g.refund_amount, 0)) AS realized_net_amount,
  GREATEST(0, g.net_amount_snapshot - COALESCE(g.refund_amount, 0) - g.settlement_price_snapshot * g.sale_quantity) AS contribution_amount,
  g.gallery_channel,
  g.related_exhibition,
  g.status,
  g.handler,
  g.created_at
FROM gallery_sales g
WHERE COALESCE(g.status, '') <> '已作废';

COMMIT;
