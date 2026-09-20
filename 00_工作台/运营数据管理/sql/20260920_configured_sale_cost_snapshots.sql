-- Freeze ticket/coffee/workshop unit costs at sale time and include them in gross profit.
-- Historical lines without a cost snapshot remain unchanged and are not backfilled.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.business_cost_facts_base_v2') IS NULL THEN
    IF to_regclass('public.business_cost_facts_v2') IS NULL THEN
      RAISE EXCEPTION 'business_cost_facts_v2 is required before applying configured sale costs';
    END IF;
    ALTER VIEW business_cost_facts_v2 RENAME TO business_cost_facts_base_v2;
  END IF;
END $$;

CREATE OR REPLACE VIEW configured_sale_cost_facts_v2 AS
WITH ticket_lines AS (
  SELECT
    r.id AS revenue_id,
    item.ord,
    r.date AS business_date,
    item.value,
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
snapshots AS (
  SELECT
    l.*,
    CASE WHEN COALESCE(l.value->>'qty',l.value->>'quantity',l.value->>'participantCount',l.value->>'participant_count','') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN COALESCE(l.value->>'qty',l.value->>'quantity',l.value->>'participantCount',l.value->>'participant_count')::NUMERIC
      ELSE 0::NUMERIC END AS quantity,
    COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot')::NUMERIC AS unit_cost
  FROM configured_lines l
  WHERE COALESCE(l.value->>'snapshotVersion',l.value->>'snapshot_version')='1'
    AND COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot','') ~ '^[0-9]+(\.[0-9]+)?$'
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
  'sale_snapshot'::TEXT AS mapping_status,
  jsonb_strip_nulls(jsonb_build_object(
    'missing_unit_cost',CASE WHEN s.unit_cost=0 THEN true ELSE NULL END
  )) AS quality_flags,
  s.created_at
FROM snapshots s
LEFT JOIN business_dimensions layer_dim
  ON layer_dim.dimension_type='business_layer' AND layer_dim.code=s.business_layer_code
LEFT JOIN business_dimensions type_dim
  ON type_dim.dimension_type='business_type' AND type_dim.code=s.business_type_code
LEFT JOIN business_dimensions cost_dim
  ON cost_dim.dimension_type='cost_type' AND cost_dim.code='product_purchase'
WHERE s.quantity<>0;

CREATE OR REPLACE VIEW business_cost_facts_v2 AS
SELECT * FROM business_cost_facts_base_v2
UNION ALL
SELECT * FROM configured_sale_cost_facts_v2;

CREATE OR REPLACE VIEW business_profit_facts_v2 AS
WITH matched_costs AS (
  SELECT source_table,source_id,source_line_key,SUM(cost_amount) AS matched_cost_amount
  FROM business_cost_facts_v2
  WHERE cost_basis IN ('sold_cogs','gallery_settlement')
  GROUP BY source_table,source_id,source_line_key
)
SELECT
  ('profit:' || r.fact_id) AS fact_id,r.fact_id AS revenue_fact_id,r.source_table,r.source_id,
  r.source_line_key,r.business_date,r.business_layer_code,r.business_layer_name,r.business_type_code,
  r.business_type_name,r.product_id,r.product_name_standard,r.quantity,r.gross_amount,
  r.net_amount AS revenue_amount,COALESCE(mc.matched_cost_amount,0) AS cost_amount,
  r.net_amount-COALESCE(mc.matched_cost_amount,0) AS gross_profit,
  CASE WHEN r.net_amount<>0 THEN (r.net_amount-COALESCE(mc.matched_cost_amount,0))/r.net_amount ELSE NULL END AS gross_margin,
  r.project_name,r.payment_method,r.mapping_status,r.quality_flags,r.created_at
FROM business_revenue_facts_v2 r
LEFT JOIN matched_costs mc ON mc.source_table=r.source_table AND mc.source_id=r.source_id AND mc.source_line_key=r.source_line_key;

CREATE OR REPLACE VIEW business_layer_summary_v2 AS
WITH months AS (
  SELECT DISTINCT LEFT(business_date,7) period_month FROM business_revenue_facts_v2
  UNION SELECT DISTINCT LEFT(business_date,7) FROM business_cost_facts_v2
), layers(code,name,sort_order) AS (VALUES
  ('visit','到馆参观',10),('onsite_consumption','现场消费',20),('experience_activity','体验活动',30),('art_transaction_cooperation','艺术交易与合作',40)
), revenue AS (
  SELECT LEFT(business_date,7) period_month,business_layer_code,SUM(net_amount) revenue_amount FROM business_revenue_facts_v2 GROUP BY 1,2
), sales_cost AS (
  SELECT LEFT(business_date,7) period_month,business_layer_code,SUM(cost_amount) sales_cost_amount FROM business_cost_facts_v2 WHERE cost_basis IN ('sold_cogs','gallery_settlement') GROUP BY 1,2
), period_cost AS (
  SELECT LEFT(business_date,7) period_month,business_layer_code,SUM(cost_amount) period_cost_amount FROM business_cost_facts_v2 WHERE cost_basis NOT IN ('sold_cogs','gallery_settlement') GROUP BY 1,2
)
SELECT m.period_month,l.code business_layer_code,l.name business_layer_name,l.sort_order,
  COALESCE(r.revenue_amount,0) revenue_amount,COALESCE(sc.sales_cost_amount,0) sales_cost_amount,
  COALESCE(pc.period_cost_amount,0) period_cost_amount,COALESCE(sc.sales_cost_amount,0)+COALESCE(pc.period_cost_amount,0) total_cost_amount,
  COALESCE(r.revenue_amount,0)-COALESCE(sc.sales_cost_amount,0) gross_profit,
  CASE WHEN COALESCE(r.revenue_amount,0)<>0 THEN (COALESCE(r.revenue_amount,0)-COALESCE(sc.sales_cost_amount,0))/r.revenue_amount ELSE NULL END gross_margin,
  COALESCE(r.revenue_amount,0)-COALESCE(sc.sales_cost_amount,0)-COALESCE(pc.period_cost_amount,0) operating_contribution
FROM months m CROSS JOIN layers l LEFT JOIN revenue r ON r.period_month=m.period_month AND r.business_layer_code=l.code
LEFT JOIN sales_cost sc ON sc.period_month=m.period_month AND sc.business_layer_code=l.code LEFT JOIN period_cost pc ON pc.period_month=m.period_month AND pc.business_layer_code=l.code;

CREATE OR REPLACE VIEW data_governance_issues_v2 AS
WITH raw_issues AS (
  SELECT 'unclassified_revenue'::TEXT issue_type,r.source_table,r.source_id,r.source_line_key,r.business_date,
    COALESCE(NULLIF(r.product_name_standard,''),NULLIF(r.project_name,''),'未命名收入') item_name,r.net_amount amount,
    '收入业务类型或映射待确认'::TEXT issue_detail,r.quality_flags
  FROM business_revenue_facts_v2 r
  WHERE r.business_type_code='uncategorized_revenue' OR r.mapping_status IN ('unmatched','pending_review','unmatched_default')
  UNION ALL
  SELECT 'unclassified_cost',c.source_table,c.source_id,c.source_line_key,c.business_date,
    COALESCE(NULLIF(c.product_name_standard,''),NULLIF(c.project_name,''),'未命名成本'),c.cost_amount,
    '成本归属待确认',c.quality_flags
  FROM business_cost_facts_v2 c
  WHERE c.cost_type_code='uncategorized_cost' OR c.mapping_status IN ('unmatched','pending_review','unmatched_default')
  UNION ALL
  SELECT 'missing_product_cost',c.source_table,c.source_id,c.source_line_key,c.business_date,
    COALESCE(NULLIF(c.product_name_standard,''),'未命名商品'),c.cost_amount,
    '已有销售但销售时成本为 0，请补充商品或作品成本',c.quality_flags
  FROM business_cost_facts_v2 c
  WHERE COALESCE((c.quality_flags->>'missing_unit_cost')::BOOLEAN,false)
     OR COALESCE((c.quality_flags->>'missing_settlement_price')::BOOLEAN,false)
)
SELECT issue_type,source_table,source_id,source_line_key,business_date,item_name,amount,issue_detail,quality_flags,
  'gov_' || SUBSTRING(MD5(CONCAT_WS('|',issue_type,source_table,source_id,COALESCE(source_line_key,''))),1,20) AS issue_id,
  CASE WHEN issue_type='missing_product_cost' THEN 'cost_evidence' ELSE 'classification' END::TEXT AS issue_group,
  CASE WHEN issue_type='missing_product_cost' THEN 'P1' ELSE 'P2' END::TEXT AS priority,
  CONCAT_WS('|',issue_type,source_table,source_id,COALESCE(source_line_key,'')) AS issue_key
FROM raw_issues;

COMMIT;
