BEGIN;

CREATE OR REPLACE VIEW business_profit_facts_v2 AS
WITH matched_costs AS (
  SELECT source_table,source_id,source_line_key,SUM(cost_amount) AS matched_cost_amount
  FROM business_cost_facts_base_v2
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
  UNION SELECT DISTINCT LEFT(business_date,7) FROM business_cost_facts_base_v2
), layers(code,name,sort_order) AS (VALUES
  ('visit','到馆参观',10),('onsite_consumption','现场消费',20),('experience_activity','体验活动',30),('art_transaction_cooperation','艺术交易与合作',40)
), revenue AS (
  SELECT LEFT(business_date,7) period_month,business_layer_code,SUM(net_amount) revenue_amount FROM business_revenue_facts_v2 GROUP BY 1,2
), sales_cost AS (
  SELECT LEFT(business_date,7) period_month,business_layer_code,SUM(cost_amount) sales_cost_amount FROM business_cost_facts_base_v2 WHERE cost_basis IN ('sold_cogs','gallery_settlement') GROUP BY 1,2
), period_cost AS (
  SELECT LEFT(business_date,7) period_month,business_layer_code,SUM(cost_amount) period_cost_amount FROM business_cost_facts_base_v2 WHERE cost_basis NOT IN ('sold_cogs','gallery_settlement') GROUP BY 1,2
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
  FROM business_cost_facts_base_v2 c
  WHERE c.cost_type_code='uncategorized_cost' OR c.mapping_status IN ('unmatched','pending_review','unmatched_default')
  UNION ALL
  SELECT 'missing_product_cost',c.source_table,c.source_id,c.source_line_key,c.business_date,
    COALESCE(NULLIF(c.product_name_standard,''),'未命名商品'),c.cost_amount,
    '已有销售但销售时成本为 0，请补充商品或作品成本',c.quality_flags
  FROM business_cost_facts_base_v2 c
  WHERE COALESCE((c.quality_flags->>'missing_unit_cost')::BOOLEAN,false)
     OR COALESCE((c.quality_flags->>'missing_settlement_price')::BOOLEAN,false)
)
SELECT issue_type,source_table,source_id,source_line_key,business_date,item_name,amount,issue_detail,quality_flags,
  'gov_' || SUBSTRING(MD5(CONCAT_WS('|',issue_type,source_table,source_id,COALESCE(source_line_key,''))),1,20) AS issue_id,
  CASE WHEN issue_type='missing_product_cost' THEN 'cost_evidence' ELSE 'classification' END::TEXT AS issue_group,
  CASE WHEN issue_type='missing_product_cost' THEN 'P1' ELSE 'P2' END::TEXT AS priority,
  CONCAT_WS('|',issue_type,source_table,source_id,COALESCE(source_line_key,'')) AS issue_key
FROM raw_issues;

DROP VIEW business_cost_facts_v2;
DROP VIEW configured_sale_cost_facts_v2;
ALTER VIEW business_cost_facts_base_v2 RENAME TO business_cost_facts_v2;

COMMIT;
