-- M4-02: stable governance issue identifiers and reviewable baseline.
-- Read-only views only. No source facts are modified.

BEGIN;

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

CREATE OR REPLACE VIEW data_governance_baseline_v2 AS
SELECT LEFT(business_date,7) AS period_month,issue_type,issue_group,priority,source_table,
  COUNT(*)::INTEGER AS issue_count,
  COUNT(DISTINCT CONCAT_WS('|',source_table,source_id))::INTEGER AS affected_record_count,
  COALESCE(SUM(ABS(amount)),0)::NUMERIC(14,2) AS affected_amount,
  MIN(business_date) AS first_business_date,
  MAX(business_date) AS last_business_date
FROM data_governance_issues_v2
GROUP BY LEFT(business_date,7),issue_type,issue_group,priority,source_table;

COMMIT;
