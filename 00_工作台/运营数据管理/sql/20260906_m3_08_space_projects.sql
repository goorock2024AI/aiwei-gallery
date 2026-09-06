BEGIN;

ALTER TABLE space_usage
  ADD COLUMN IF NOT EXISTS business_layer_code TEXT DEFAULT 'art_transaction_cooperation',
  ADD COLUMN IF NOT EXISTS business_type_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cooperation_mode TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS project_owner TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_no TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_status TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_space_usage_business_type ON space_usage(business_type_code);
CREATE INDEX IF NOT EXISTS idx_space_usage_business_status ON space_usage(business_status);
CREATE INDEX IF NOT EXISTS idx_space_usage_contract_no ON space_usage(contract_no);

CREATE OR REPLACE VIEW space_usage_with_payments AS
SELECT
  s.id, s.date, s.end_date, s.space, s.project_name, s.type, s.client,
  s.status, s.rental_type, s.receivable_amount, s.expected_payment_date,
  s.notes, s.created_at,
  COALESCE((SELECT json_agg(json_build_object('id',p.id,'paymentDate',p.payment_date,'amount',p.amount,'paymentMethod',p.payment_method,'notes',p.notes,'createdAt',p.created_at) ORDER BY p.payment_date,p.created_at) FROM space_payments p WHERE p.space_usage_id=s.id),'[]'::json) AS payments,
  COALESCE((SELECT SUM(p.amount) FROM space_payments p WHERE p.space_usage_id=s.id),0) AS received_amount,
  s.business_layer_code, s.business_type_code, s.cooperation_mode,
  s.project_owner, s.contract_no, s.business_status
FROM space_usage s;

CREATE OR REPLACE VIEW space_project_performance_v2 AS
SELECT
  s.id, s.date AS start_date, NULLIF(s.end_date,'') AS end_date, s.space,
  s.project_name, s.client, s.type AS execution_type,
  COALESCE(NULLIF(s.business_type_code,''),'uncategorized_revenue') AS business_type_code,
  s.cooperation_mode, s.project_owner, s.contract_no,
  COALESCE(NULLIF(s.business_status,''),'待确认') AS business_status,
  s.rental_type, s.receivable_amount,
  COALESCE(SUM(p.amount),0) AS received_amount,
  GREATEST(0,s.receivable_amount-COALESCE(SUM(p.amount),0)) AS outstanding_amount,
  COUNT(p.id)::INTEGER AS payment_count,
  MIN(p.payment_date) AS first_payment_date,
  MAX(p.payment_date) AS latest_payment_date,
  s.expected_payment_date,
  s.created_at
FROM space_usage s
LEFT JOIN space_payments p ON p.space_usage_id=s.id
GROUP BY s.id;

COMMIT;
