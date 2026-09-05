-- Restore only cost classification. Keep M3-04 revenue snapshots and saved links.
BEGIN;
CREATE OR REPLACE VIEW business_cost_facts_v2 AS
WITH expense_facts AS (
  SELECT
    ('expense:' || e.id) AS fact_id,
    'expense'::TEXT AS source_table,
    e.id AS source_id,
    'expense'::TEXT AS source_line_key,
    e.date AS business_date,
    'period_expense'::TEXT AS cost_basis,
    COALESCE(NULLIF(link.business_layer_code, ''), NULLIF(rule.business_layer_code, ''), '') AS business_layer_code,
    COALESCE(NULLIF(link.business_type_code, ''), NULLIF(rule.business_type_code, ''), '') AS business_type_code,
    COALESCE(NULLIF(link.cost_type_code, ''), NULLIF(rule.cost_type_code, ''), 'uncategorized_cost') AS cost_type_code,
    COALESCE(NULLIF(link.capability_axis_code, ''), NULLIF(rule.capability_axis_code, ''), '') AS capability_axis_code,
    ''::TEXT AS product_id,
    COALESCE(NULLIF(e.project, ''), NULLIF(e.category, ''), '支出') AS product_name_standard,
    0::NUMERIC AS quantity,
    0::NUMERIC AS unit_cost,
    COALESCE(e.amount, 0)::NUMERIC AS cost_amount,
    e.project AS project_name,
    e.handler,
    (link.id IS NOT NULL) AS is_manual_override,
    CASE WHEN link.id IS NOT NULL THEN 'manual_link' WHEN rule.id IS NOT NULL THEN 'rule_match' ELSE 'unmatched_default' END AS mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_business_layer', CASE WHEN COALESCE(NULLIF(link.business_layer_code, ''), NULLIF(rule.business_layer_code, ''), '') = '' THEN true ELSE NULL END,
      'missing_business_type', CASE WHEN COALESCE(NULLIF(link.business_type_code, ''), NULLIF(rule.business_type_code, ''), '') = '' THEN true ELSE NULL END
    )) AS quality_flags,
    e.created_at
  FROM expense e
  LEFT JOIN record_business_links link
    ON link.source_table = 'expense'
   AND link.source_id = e.id
   AND link.source_line_key = 'expense'
  LEFT JOIN LATERAL (
    SELECT br.*
    FROM business_mapping_rules br
    WHERE br.source_table = 'expense'
      AND br.is_active = true
      AND (
        (br.source_field = 'category' AND br.match_type = 'exact' AND br.match_value = e.category)
        OR (br.source_field = 'category' AND br.match_type = 'contains' AND e.category ILIKE ('%' || br.match_value || '%'))
        OR (br.source_field = 'description' AND br.match_type = 'contains' AND e.description ILIKE ('%' || br.match_value || '%'))
      )
    ORDER BY br.priority DESC, br.confidence DESC
    LIMIT 1
  ) rule ON true
),
retail_cogs AS (
  SELECT
    ('cogs:' || r.fact_id) AS fact_id,
    r.source_table,
    r.source_id,
    r.source_line_key,
    r.business_date,
    'sold_cogs'::TEXT AS cost_basis,
    r.business_layer_code,
    r.business_type_code,
    'product_purchase'::TEXT AS cost_type_code,
    ''::TEXT AS capability_axis_code,
    r.product_id,
    r.product_name_standard,
    r.quantity,
    r.unit_cost,
    COALESCE(r.quantity, 0) * COALESCE(r.unit_cost, 0) AS cost_amount,
    r.project_name,
    r.handler,
    r.is_manual_override,
    r.mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_unit_cost', CASE WHEN COALESCE(r.unit_cost, 0) = 0 THEN true ELSE NULL END
    )) AS quality_flags,
    r.created_at
  FROM business_revenue_facts_v2 r
  WHERE r.source_table = 'revenue'
    AND r.business_type_code IN ('creative_retail', 'beverage_retail')
    AND COALESCE(r.quantity, 0) <> 0
),
gallery_settlement AS (
  SELECT
    ('gallery_settlement:' || g.id) AS fact_id,
    'gallery_sales'::TEXT AS source_table,
    g.id AS source_id,
    'gallery_sale'::TEXT AS source_line_key,
    g.date AS business_date,
    'gallery_settlement'::TEXT AS cost_basis,
    'art_transaction_cooperation'::TEXT AS business_layer_code,
    COALESCE(NULLIF(g.business_type_code, ''), 'gallery_sale') AS business_type_code,
    'gallery_transaction'::TEXT AS cost_type_code,
    'business_cooperation'::TEXT AS capability_axis_code,
    COALESCE(NULLIF(g.artwork_id, ''), '') AS product_id,
    COALESCE(NULLIF(g.artwork_name, ''), NULLIF(a.title, ''), NULLIF(g.artwork_no, ''), '作品结算') AS product_name_standard,
    COALESCE(NULLIF(g.sale_quantity, 0), 1)::NUMERIC AS quantity,
    COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0)::NUMERIC AS unit_cost,
    COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0)::NUMERIC * COALESCE(NULLIF(g.sale_quantity, 0), 1)::NUMERIC AS cost_amount,
    COALESCE(NULLIF(g.related_exhibition, ''), '画廊') AS project_name,
    g.handler,
    false AS is_manual_override,
    'system_field'::TEXT AS mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_settlement_price', CASE WHEN COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0) = 0 THEN true ELSE NULL END
    )) AS quality_flags,
    g.created_at
  FROM gallery_sales g
  LEFT JOIN artworks a
    ON a.id = g.artwork_id
    OR (NULLIF(g.artwork_id, '') IS NULL AND a.artwork_no = g.artwork_no)
  WHERE COALESCE(g.status, '') <> '已作废'
)
SELECT
  cf.fact_id,
  cf.source_table,
  cf.source_id,
  cf.source_line_key,
  cf.business_date,
  cf.cost_basis,
  cf.business_layer_code,
  COALESCE(layer_dim.name, cf.business_layer_code) AS business_layer_name,
  cf.business_type_code,
  COALESCE(type_dim.name, cf.business_type_code) AS business_type_name,
  cf.cost_type_code,
  COALESCE(cost_dim.name, cf.cost_type_code) AS cost_type_name,
  cf.capability_axis_code,
  COALESCE(cap_dim.name, cf.capability_axis_code) AS capability_axis_name,
  cf.product_id,
  cf.product_name_standard,
  cf.quantity,
  cf.unit_cost,
  cf.cost_amount,
  cf.project_name,
  cf.handler,
  cf.is_manual_override,
  cf.mapping_status,
  cf.quality_flags,
  cf.created_at
FROM (
  SELECT * FROM expense_facts
  UNION ALL
  SELECT * FROM retail_cogs
  UNION ALL
  SELECT * FROM gallery_settlement
) cf
LEFT JOIN business_dimensions layer_dim
  ON layer_dim.dimension_type = 'business_layer'
 AND layer_dim.code = cf.business_layer_code
LEFT JOIN business_dimensions type_dim
  ON type_dim.dimension_type = 'business_type'
 AND type_dim.code = cf.business_type_code
LEFT JOIN business_dimensions cost_dim
  ON cost_dim.dimension_type = 'cost_type'
 AND cost_dim.code = cf.cost_type_code
LEFT JOIN business_dimensions cap_dim
  ON cap_dim.dimension_type = 'capability_axis'
 AND cap_dim.code = cf.capability_axis_code;


DROP FUNCTION IF EXISTS match_expense_rule_v2(TEXT,TEXT,TEXT,TEXT);
DELETE FROM business_mapping_rules WHERE id IN ('m305_labor','m305_admin','m305_tax','m305_asset','m305_exhibition');
COMMIT;
