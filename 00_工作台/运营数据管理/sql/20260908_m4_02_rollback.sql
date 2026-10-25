-- M4-02 rollback: remove baseline view and restore the M3-09 issue view.
-- Source facts and governance records are preserved.

BEGIN;
DROP VIEW IF EXISTS data_governance_baseline_v2;
DROP VIEW IF EXISTS data_governance_issues_v2;
CREATE OR REPLACE VIEW data_governance_issues_v2 AS
SELECT 'unclassified_revenue'::TEXT issue_type,r.source_table,r.source_id,r.source_line_key,r.business_date,
  COALESCE(NULLIF(r.product_name_standard,''),NULLIF(r.project_name,''),'未命名收入') item_name,r.net_amount amount,'收入业务类型或映射待确认'::TEXT issue_detail,r.quality_flags
FROM business_revenue_facts_v2 r WHERE r.business_type_code='uncategorized_revenue' OR r.mapping_status IN ('unmatched','pending_review','unmatched_default')
UNION ALL
SELECT 'unclassified_cost',c.source_table,c.source_id,c.source_line_key,c.business_date,
  COALESCE(NULLIF(c.product_name_standard,''),NULLIF(c.project_name,''),'未命名成本'),c.cost_amount,'成本归属待确认',c.quality_flags
FROM business_cost_facts_v2 c WHERE c.cost_type_code='uncategorized_cost' OR c.mapping_status IN ('unmatched','pending_review','unmatched_default')
UNION ALL
SELECT 'missing_product_cost',c.source_table,c.source_id,c.source_line_key,c.business_date,
  COALESCE(NULLIF(c.product_name_standard,''),'未命名商品'),c.cost_amount,'已有销售但销售时成本为 0，请补充商品或作品成本',c.quality_flags
FROM business_cost_facts_v2 c WHERE COALESCE((c.quality_flags->>'missing_unit_cost')::BOOLEAN,false) OR COALESCE((c.quality_flags->>'missing_settlement_price')::BOOLEAN,false);
COMMIT;
