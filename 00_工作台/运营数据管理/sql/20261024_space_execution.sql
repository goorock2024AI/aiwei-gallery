BEGIN;

-- No historical payment, closing or report is rewritten. Execution requires evidence.
CREATE TABLE IF NOT EXISTS space_execution_lines (
  id TEXT PRIMARY KEY,
  space_usage_id TEXT NOT NULL REFERENCES space_usage(id) ON DELETE RESTRICT,
  usage_date TEXT NOT NULL CHECK (usage_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','confirmed','voided')),
  notes TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT, confirmed_at TIMESTAMPTZ,
  void_reason TEXT, voided_by TEXT, voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS space_execution_active_day
  ON space_execution_lines(space_usage_id,usage_date) WHERE status <> 'voided';

-- Refunds retain the original receipt. The negative receipt uses the actual refund day.
CREATE TABLE IF NOT EXISTS space_payment_refunds (
  id TEXT PRIMARY KEY,
  original_payment_id TEXT NOT NULL REFERENCES space_payments(id) ON DELETE RESTRICT,
  refund_payment_id TEXT NOT NULL UNIQUE REFERENCES space_payments(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Capture the installed, fully patched fact definition once, retaining classifications.
-- Replaying this migration must never capture the new execution view recursively.
DO $$ BEGIN
  IF to_regclass('public.business_cash_revenue_facts_v2') IS NULL THEN
    EXECUTE 'CREATE VIEW business_cash_revenue_facts_v2 AS ' || pg_get_viewdef('public.business_revenue_facts_v2'::regclass,true);
  END IF;
END $$;

CREATE OR REPLACE VIEW business_revenue_facts_v2 AS
SELECT * FROM business_cash_revenue_facts_v2
WHERE source_table <> 'space_payments'
  AND NOT (source_table='revenue' AND source_line_key='venue_amount')
UNION ALL
SELECT
  'space_execution:'||e.id AS fact_id, 'space_execution_lines'::TEXT AS source_table,
  e.id AS source_id, 'space_execution'::TEXT AS source_line_key,
  e.usage_date AS business_date, 'space_execution'::TEXT AS source_category,
  'art_transaction_cooperation'::TEXT AS business_layer_code,
  COALESCE(layer.name,'艺术交易与合作') AS business_layer_name,
  COALESCE(NULLIF(s.business_type_code,''),'space_rental') AS business_type_code,
  COALESCE(kind.name,'场地租赁') AS business_type_name,
  ''::TEXT AS product_id, s.project_name AS product_name_raw,
  s.project_name AS product_name_standard, COALESCE(s.cooperation_mode,'') AS package_spec,
  e.amount AS unit_price, 1::NUMERIC AS quantity, 0::NUMERIC AS unit_cost,
  e.amount AS gross_amount, e.amount AS net_amount,
  ''::TEXT AS payment_method, s.project_name, COALESCE(s.project_owner,'') AS handler,
  false AS is_beverage, false AS is_manual_override, 'execution_confirmed'::TEXT AS mapping_status,
  jsonb_build_object('execution_basis',true,'space_usage_id',s.id,'missing_cost',true) AS quality_flags,
  e.created_at
FROM space_execution_lines e JOIN space_usage s ON s.id=e.space_usage_id
LEFT JOIN business_dimensions layer ON layer.dimension_type='business_layer' AND layer.code='art_transaction_cooperation'
LEFT JOIN business_dimensions kind ON kind.dimension_type='business_type' AND kind.code=COALESCE(NULLIF(s.business_type_code,''),'space_rental')
WHERE e.status='confirmed';

COMMIT;
