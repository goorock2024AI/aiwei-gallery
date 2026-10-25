-- M3-05: expense classification; run after M3-02 and M3-04.
BEGIN;
CREATE OR REPLACE FUNCTION match_expense_rule_v2(p_project TEXT, p_activity TEXT, p_category TEXT, p_description TEXT)
RETURNS SETOF business_mapping_rules LANGUAGE SQL STABLE AS $$
  SELECT br.* FROM business_mapping_rules br
  CROSS JOIN LATERAL (SELECT CASE br.source_field
    WHEN 'project' THEN COALESCE(p_project, '')
    WHEN 'related_activity' THEN COALESCE(p_activity, '')
    WHEN 'category' THEN COALESCE(p_category, '')
    WHEN 'description' THEN COALESCE(p_description, '') END AS value) src
  WHERE br.source_table = 'expense' AND br.is_active = true
    AND br.match_value <> '' AND src.value IS NOT NULL
    AND CASE br.match_type
      WHEN 'exact' THEN src.value = br.match_value
      WHEN 'contains' THEN strpos(lower(src.value), lower(br.match_value)) > 0
      WHEN 'prefix' THEN left(lower(src.value), length(br.match_value)) = lower(br.match_value)
      WHEN 'suffix' THEN right(lower(src.value), length(br.match_value)) = lower(br.match_value)
      ELSE false END
  ORDER BY CASE br.source_field WHEN 'project' THEN 1 WHEN 'related_activity' THEN 2 WHEN 'category' THEN 3 ELSE 4 END,
    br.priority DESC, br.confidence DESC, br.id
  LIMIT 1
$$;

INSERT INTO business_mapping_rules(id,source_table,source_field,match_type,match_value,cost_type_code,capability_axis_code,priority,notes)
VALUES
 ('m305_labor','expense','category','exact','人员劳务','labor','',800,'M3-05：成本类型建议，不自动分摊共享费用。'),
 ('m305_admin','expense','category','exact','办公行政','admin_finance','',800,'M3-05：行政成本建议。'),
 ('m305_tax','expense','category','exact','税费手续费','admin_finance','',800,'M3-05：财务成本建议。'),
 ('m305_asset','expense','category','exact','设备资产','equipment_asset','',800,'M3-05：设备资产不自动分摊到单项业务。'),
 ('m305_exhibition','expense','category','exact','活动展览成本','exhibition_content','content_ip',800,'M3-05：展览与内容成本，业务层需结合项目确认。')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW business_cost_facts_v2 AS
WITH expense_facts AS (
  SELECT
    ('expense:' || e.id) AS fact_id,
    'expense'::TEXT AS source_table,
    e.id AS source_id,
    'expense'::TEXT AS source_line_key,
    e.date AS business_date,
    'period_expense'::TEXT AS cost_basis,
    CASE WHEN link.id IS NOT NULL THEN COALESCE(NULLIF(link.business_layer_code, ''), '') ELSE COALESCE(NULLIF(rule.business_layer_code, ''), '') END AS business_layer_code,
    CASE WHEN link.id IS NOT NULL THEN COALESCE(NULLIF(link.business_type_code, ''), '') ELSE COALESCE(NULLIF(rule.business_type_code, ''), '') END AS business_type_code,
    CASE WHEN link.id IS NOT NULL THEN COALESCE(NULLIF(link.cost_type_code, ''), 'uncategorized_cost') ELSE COALESCE(NULLIF(rule.cost_type_code, ''), 'uncategorized_cost') END AS cost_type_code,
    CASE WHEN link.id IS NOT NULL THEN COALESCE(NULLIF(link.capability_axis_code, ''), '') ELSE COALESCE(NULLIF(rule.capability_axis_code, ''), '') END AS capability_axis_code,
    ''::TEXT AS product_id,
    COALESCE(NULLIF(e.project, ''), NULLIF(e.category, ''), '支出') AS product_name_standard,
    0::NUMERIC AS quantity,
    0::NUMERIC AS unit_cost,
    COALESCE(e.amount, 0)::NUMERIC AS cost_amount,
    e.project AS project_name,
    e.handler,
    (link.id IS NOT NULL) AS is_manual_override,
    CASE WHEN link.id IS NOT NULL AND COALESCE(link.cost_type_code, 'uncategorized_cost') = 'uncategorized_cost' THEN 'pending_review' WHEN link.id IS NOT NULL AND COALESCE(link.mapping_rule_id, '') <> '' THEN 'rule_confirmed' WHEN link.id IS NOT NULL THEN 'manual_link' WHEN rule.id IS NOT NULL THEN 'rule_match' ELSE 'unmatched_default' END AS mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_business_layer', CASE WHEN CASE WHEN link.id IS NOT NULL THEN COALESCE(link.business_layer_code, '') ELSE COALESCE(rule.business_layer_code, '') END = '' THEN true ELSE NULL END,
      'missing_business_type', CASE WHEN CASE WHEN link.id IS NOT NULL THEN COALESCE(link.business_type_code, '') ELSE COALESCE(rule.business_type_code, '') END = '' THEN true ELSE NULL END
    )) AS quality_flags,
    e.created_at
  FROM expense e
  LEFT JOIN record_business_links link
    ON link.source_table = 'expense'
   AND link.source_id = e.id
   AND link.source_line_key = 'expense'
  LEFT JOIN LATERAL match_expense_rule_v2(e.project, e.related_activity, e.category, e.description) rule ON true
  WHERE COALESCE(e.type, '运营支出') <> '备用金借入'
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


COMMIT;
