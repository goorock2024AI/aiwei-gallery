-- From 2026-09-01, every configured-product sale produces a cost fact.
-- Positive sale-time snapshots take precedence. Missing/zero snapshots use the current
-- product cost configuration, so completing a missing cost automatically updates history.
-- Original revenue rows remain unchanged.
BEGIN;

CREATE OR REPLACE VIEW configured_sale_cost_facts_v2 AS
WITH ticket_lines AS (
  SELECT
    r.id AS revenue_id,
    item.ord,
    r.date AS business_date,
    item.value,
    'ticket'::TEXT AS product_category,
    CASE WHEN COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','')='套票'
      THEN 'combo' ELSE 'ticket' END AS source_line_key,
    CASE WHEN COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','')='套票'
      THEN 'visit_combo' ELSE 'ticket' END AS business_type_code,
    'visit'::TEXT AS business_layer_code,
    COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','门票') AS product_name,
    r.project_name,
    r.handler,
    r.created_at
  FROM revenue r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.ticket_items)='array' THEN r.ticket_items ELSE '[]'::JSONB END
  ) WITH ORDINALITY AS item(value,ord)
  WHERE COALESCE(r.status,'')<>'已作废'
),
coffee_lines AS (
  SELECT
    r.id AS revenue_id,
    item.ord,
    r.date AS business_date,
    item.value,
    'coffee'::TEXT AS product_category,
    'coffee'::TEXT AS source_line_key,
    'coffee'::TEXT AS business_type_code,
    'onsite_consumption'::TEXT AS business_layer_code,
    COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','咖啡') AS product_name,
    r.project_name,
    r.handler,
    r.created_at
  FROM revenue r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.coffee_items)='array' THEN r.coffee_items ELSE '[]'::JSONB END
  ) WITH ORDINALITY AS item(value,ord)
  WHERE COALESCE(r.status,'')<>'已作废'
),
workshop_lines AS (
  SELECT
    r.id AS revenue_id,
    item.ord,
    r.date AS business_date,
    item.value,
    'workshop'::TEXT AS product_category,
    ('workshop:' || item.ord::TEXT) AS source_line_key,
    CASE WHEN COALESCE(item.value->>'activityTypeCode',item.value->>'activity_type_code')='course_study'
      THEN 'course_study' ELSE 'workshop' END AS business_type_code,
    'experience_activity'::TEXT AS business_layer_code,
    COALESCE(item.value->>'productName',item.value->>'product_name',item.value->>'name','工坊/体验') AS product_name,
    COALESCE(NULLIF(item.value->>'projectName',''),NULLIF(item.value->>'project_name',''),r.project_name) AS project_name,
    r.handler,
    r.created_at
  FROM revenue r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.workshop_items)='array' THEN r.workshop_items ELSE '[]'::JSONB END
  ) WITH ORDINALITY AS item(value,ord)
  WHERE COALESCE(r.status,'')<>'已作废'
),
configured_lines AS (
  SELECT * FROM ticket_lines
  UNION ALL SELECT * FROM coffee_lines
  UNION ALL SELECT * FROM workshop_lines
),
configured_costs AS (
  SELECT
    CASE c.key
      WHEN 'ticket_products' THEN 'ticket'
      WHEN 'coffee_products' THEN 'coffee'
      WHEN 'workshop_products' THEN 'workshop'
    END::TEXT AS product_category,
    COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','') AS product_name,
    CASE
      WHEN COALESCE(item.value->>'costPrice',item.value->>'cost_price','') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN COALESCE(item.value->>'costPrice',item.value->>'cost_price')::NUMERIC
      ELSE 0::NUMERIC
    END AS unit_cost
  FROM app_config c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.value)='array' THEN c.value ELSE '[]'::JSONB END
  ) item(value)
  WHERE c.key IN ('ticket_products','coffee_products','workshop_products')
),
parsed_lines AS (
  SELECT
    l.*,
    CASE WHEN COALESCE(l.value->>'qty',l.value->>'quantity',l.value->>'participantCount',l.value->>'participant_count','') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN COALESCE(l.value->>'qty',l.value->>'quantity',l.value->>'participantCount',l.value->>'participant_count')::NUMERIC
      ELSE 0::NUMERIC END AS quantity,
    CASE
      WHEN COALESCE(l.value->>'snapshotVersion',l.value->>'snapshot_version')='1'
       AND COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot','') ~ '^[0-9]+(\.[0-9]+)?$'
       AND COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot')::NUMERIC>0
      THEN COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot')::NUMERIC
      ELSE NULL::NUMERIC
    END AS snapshot_unit_cost
  FROM configured_lines l
),
costed_lines AS (
  SELECT
    l.*,
    COALESCE(l.snapshot_unit_cost,configured.unit_cost,0::NUMERIC) AS unit_cost,
    CASE
      WHEN l.snapshot_unit_cost IS NOT NULL
      THEN 'sale_snapshot'
      WHEN COALESCE(configured.unit_cost,0)>0
      THEN 'current_config_backfill'
      ELSE 'missing_cost_config'
    END AS cost_mapping_status
  FROM parsed_lines l
  LEFT JOIN LATERAL (
    SELECT c.unit_cost
    FROM configured_costs c
    WHERE c.product_category=l.product_category
      AND c.product_name=l.product_name
    ORDER BY c.unit_cost DESC
    LIMIT 1
  ) configured ON true
  WHERE l.snapshot_unit_cost IS NOT NULL OR l.business_date::DATE>='2026-09-01'::DATE
)
SELECT
  ('configured_cogs:revenue:' || s.revenue_id || ':' || s.source_line_key || ':' || s.ord::TEXT) AS fact_id,
  'revenue'::TEXT AS source_table,
  s.revenue_id AS source_id,
  s.source_line_key,
  s.business_date,
  'sold_cogs'::TEXT AS cost_basis,
  s.business_layer_code,
  COALESCE(layer_dim.name,s.business_layer_code) AS business_layer_name,
  s.business_type_code,
  COALESCE(type_dim.name,s.business_type_code) AS business_type_name,
  'product_purchase'::TEXT AS cost_type_code,
  COALESCE(cost_dim.name,'商品采购/销售成本') AS cost_type_name,
  ''::TEXT AS capability_axis_code,
  ''::TEXT AS capability_axis_name,
  ''::TEXT AS product_id,
  s.product_name AS product_name_standard,
  s.quantity,
  s.unit_cost,
  s.quantity * s.unit_cost AS cost_amount,
  s.project_name,
  s.handler,
  false AS is_manual_override,
  s.cost_mapping_status AS mapping_status,
  jsonb_strip_nulls(jsonb_build_object(
    'missing_unit_cost',CASE WHEN s.unit_cost<=0 THEN true ELSE NULL END,
    'historical_config_cost',CASE WHEN s.cost_mapping_status='current_config_backfill' THEN true ELSE NULL END,
    'cost_config_missing',CASE WHEN s.cost_mapping_status='missing_cost_config' THEN true ELSE NULL END
  )) AS quality_flags,
  s.created_at
FROM costed_lines s
LEFT JOIN business_dimensions layer_dim
  ON layer_dim.dimension_type='business_layer' AND layer_dim.code=s.business_layer_code
LEFT JOIN business_dimensions type_dim
  ON type_dim.dimension_type='business_type' AND type_dim.code=s.business_type_code
LEFT JOIN business_dimensions cost_dim
  ON cost_dim.dimension_type='cost_type' AND cost_dim.code='product_purchase'
WHERE s.quantity<>0;

COMMIT;
