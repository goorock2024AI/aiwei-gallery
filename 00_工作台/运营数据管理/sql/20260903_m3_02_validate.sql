-- M3-02 validation checks.
-- This script is read-only and should be run after the three M3-02 migration scripts.

SELECT
  'core_row_counts' AS check_name,
  table_name,
  row_count
FROM (
  SELECT 'revenue'::TEXT AS table_name, COUNT(*)::BIGINT AS row_count FROM revenue
  UNION ALL SELECT 'expense', COUNT(*)::BIGINT FROM expense
  UNION ALL SELECT 'creative_products', COUNT(*)::BIGINT FROM creative_products
  UNION ALL SELECT 'gallery_sales', COUNT(*)::BIGINT FROM gallery_sales
  UNION ALL SELECT 'space_usage', COUNT(*)::BIGINT FROM space_usage
  UNION ALL SELECT 'space_payments', COUNT(*)::BIGINT FROM space_payments
) counts
ORDER BY table_name;

SELECT
  'new_schema_objects' AS check_name,
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'business_dimensions',
    'business_mapping_rules',
    'product_aliases',
    'record_business_links',
    'business_revenue_facts_v2',
    'business_cost_facts_v2',
    'business_profit_facts_v2'
  )
ORDER BY table_name;

SELECT
  'required_dimension_counts' AS check_name,
  dimension_type,
  COUNT(*) AS active_count
FROM business_dimensions
WHERE is_active = true
GROUP BY dimension_type
ORDER BY dimension_type;

SELECT
  'extension_columns' AS check_name,
  table_name,
  COUNT(*) AS found_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'creative_products' AND column_name IN ('standard_name', 'business_type_code', 'package_spec', 'barcode', 'is_beverage', 'is_countable_stock', 'is_active'))
    OR (table_name = 'gallery_sales' AND column_name IN ('artwork_id', 'settlement_price_snapshot', 'retail_price_snapshot', 'gross_amount_snapshot', 'net_amount_snapshot', 'gallery_channel', 'business_type_code'))
    OR (table_name = 'space_usage' AND column_name IN ('business_layer_code', 'business_type_code', 'cooperation_mode', 'project_owner', 'contract_no', 'business_status'))
  )
GROUP BY table_name
ORDER BY table_name;

SELECT
  'v2_monthly_revenue_total' AS check_name,
  date_trunc('month', business_date::DATE)::DATE AS month,
  business_layer_code,
  business_type_code,
  SUM(net_amount) AS net_amount
FROM business_revenue_facts_v2
GROUP BY date_trunc('month', business_date::DATE)::DATE, business_layer_code, business_type_code
ORDER BY month, business_layer_code, business_type_code;

SELECT
  'legacy_vs_v2_revenue_amount' AS check_name,
  legacy.month,
  legacy.legacy_total_amount,
  v2.v2_total_amount,
  v2.v2_total_amount - legacy.legacy_total_amount AS amount_diff
FROM (
  SELECT
    date_trunc('month', date::DATE)::DATE AS month,
    SUM(net_amount) AS legacy_total_amount
  FROM revenue_facts
  GROUP BY date_trunc('month', date::DATE)::DATE
) legacy
LEFT JOIN (
  SELECT
    date_trunc('month', business_date::DATE)::DATE AS month,
    SUM(net_amount) AS v2_total_amount
  FROM business_revenue_facts_v2
  GROUP BY date_trunc('month', business_date::DATE)::DATE
) v2 ON v2.month = legacy.month
ORDER BY legacy.month;

SELECT
  'duplicate_revenue_fact_ids' AS check_name,
  fact_id,
  COUNT(*) AS duplicate_count
FROM business_revenue_facts_v2
GROUP BY fact_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, fact_id;

SELECT
  'duplicate_cost_fact_ids' AS check_name,
  fact_id,
  COUNT(*) AS duplicate_count
FROM business_cost_facts_v2
GROUP BY fact_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, fact_id;

SELECT
  'mapping_quality_revenue' AS check_name,
  mapping_status,
  COUNT(*) AS row_count,
  SUM(net_amount) AS net_amount
FROM business_revenue_facts_v2
GROUP BY mapping_status
ORDER BY row_count DESC;

SELECT
  'missing_retail_unit_cost' AS check_name,
  business_type_code,
  product_name_standard,
  unit_price,
  COUNT(*) AS row_count,
  SUM(quantity) AS quantity,
  SUM(net_amount) AS net_amount
FROM business_revenue_facts_v2
WHERE business_type_code IN ('creative_retail', 'beverage_retail')
  AND COALESCE(unit_cost, 0) = 0
GROUP BY business_type_code, product_name_standard, unit_price
ORDER BY net_amount DESC NULLS LAST, quantity DESC;

SELECT
  'profit_preview_by_month' AS check_name,
  date_trunc('month', business_date::DATE)::DATE AS month,
  business_layer_code,
  business_type_code,
  SUM(revenue_amount) AS revenue_amount,
  SUM(cost_amount) AS cost_amount,
  SUM(gross_profit) AS gross_profit
FROM business_profit_facts_v2
GROUP BY date_trunc('month', business_date::DATE)::DATE, business_layer_code, business_type_code
ORDER BY month, business_layer_code, business_type_code;
