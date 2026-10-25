-- M4-04: product classification completeness and cost evidence.
-- Read-only governance views only. Current cost is never backdated automatically.

BEGIN;

CREATE OR REPLACE VIEW product_cost_evidence_v2 AS
WITH retail_lines AS (
  SELECT
    r.id AS revenue_id,
    ('retail:' || item.ord::TEXT) AS source_line_key,
    r.date AS business_date,
    item.value AS item
  FROM revenue r
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
    CASE WHEN JSONB_TYPEOF(r.retail_items) = 'array' THEN r.retail_items ELSE '[]'::JSONB END
  ) WITH ORDINALITY AS item(value, ord)
  WHERE COALESCE(r.status, '') <> '已作废'
),
sale_snapshot_evidence AS (
  SELECT
    'costev_' || SUBSTRING(MD5(CONCAT_WS('|','sale_snapshot','revenue',revenue_id,source_line_key)),1,20) AS evidence_id,
    COALESCE(item->>'productId', item->>'product_id') AS product_id,
    COALESCE(item->>'standardName', item->>'standard_name', item->>'productName', item->>'product_name', item->>'name', '') AS product_name,
    'sale_snapshot'::TEXT AS evidence_type,
    'verified_historical_observation'::TEXT AS evidence_status,
    COALESCE(item->>'costPriceSnapshot', item->>'cost_price_snapshot')::NUMERIC(12,2) AS unit_cost,
    business_date AS evidence_date,
    business_date AS valid_from,
    business_date AS valid_to,
    'revenue'::TEXT AS source_table,
    revenue_id AS source_id,
    source_line_key,
    '销售明细冻结成本'::TEXT AS evidence_label,
    1.00::NUMERIC(5,2) AS confidence,
    'observed_sale_only'::TEXT AS historical_application,
    '仅证明该笔成交日成本；相邻日期是否同成本需更多证据'::TEXT AS review_note
  FROM retail_lines
  WHERE COALESCE(item->>'snapshotVersion', item->>'snapshot_version') = '1'
    AND NULLIF(COALESCE(item->>'productId', item->>'product_id'), '') IS NOT NULL
    AND COALESCE(item->>'costPriceSnapshot', item->>'cost_price_snapshot', '') ~ '^[0-9]+(\.[0-9]+)?$'
    AND COALESCE(item->>'costPriceSnapshot', item->>'cost_price_snapshot')::NUMERIC > 0
),
alias_evidence AS (
  SELECT
    'costev_' || SUBSTRING(MD5(CONCAT_WS('|','alias_snapshot','product_aliases',pa.id)),1,20),
    pa.standard_product_id,
    pa.standard_name,
    'alias_cost_snapshot',
    'period_confirmation_required',
    pa.cost_price_snapshot::NUMERIC(12,2),
    COALESCE(pa.updated_at, pa.created_at)::DATE::TEXT,
    COALESCE(pa.updated_at, pa.created_at)::DATE::TEXT,
    NULL::TEXT,
    'product_aliases',
    pa.id,
    ''::TEXT,
    '商品别名成本参考',
    LEAST(COALESCE(pa.confidence,0.80),0.90)::NUMERIC(5,2),
    'requires_period_confirmation',
    '可作为成本参考，但适用起止日期必须人工确认'
  FROM product_aliases pa
  WHERE pa.is_active = true
    AND NULLIF(pa.standard_product_id, '') IS NOT NULL
    AND COALESCE(pa.cost_price_snapshot, 0) > 0
),
current_master_evidence AS (
  SELECT
    'costev_' || SUBSTRING(MD5(CONCAT_WS('|','current_master','creative_products',cp.id)),1,20),
    cp.id,
    COALESCE(NULLIF(cp.standard_name,''),cp.name),
    'current_master_cost',
    'current_reference_only',
    cp.cost_price::NUMERIC(12,2),
    COALESCE(cp.updated_at,cp.created_at)::DATE::TEXT,
    COALESCE(cp.updated_at,cp.created_at)::DATE::TEXT,
    NULL::TEXT,
    'creative_products',
    cp.id,
    ''::TEXT,
    '商品当前成本',
    0.70::NUMERIC(5,2),
    'current_forward_only',
    '仅作为记录更新日起的当前参考，不自动倒推更早销售'
  FROM creative_products cp
  WHERE COALESCE(cp.is_active,true) = true
    AND COALESCE(cp.cost_price,0) > 0
)
SELECT * FROM sale_snapshot_evidence
UNION ALL SELECT * FROM alias_evidence
UNION ALL SELECT * FROM current_master_evidence;

CREATE OR REPLACE VIEW product_master_governance_v2 AS
WITH sales AS (
  SELECT
    r.product_id,
    COUNT(*)::INTEGER AS sales_line_count,
    COUNT(DISTINCT CONCAT_WS('|',r.source_table,r.source_id))::INTEGER AS affected_record_count,
    COALESCE(SUM(r.quantity),0)::NUMERIC(14,2) AS sales_quantity,
    COALESCE(SUM(ABS(r.net_amount)),0)::NUMERIC(14,2) AS affected_amount,
    MIN(r.business_date) AS first_business_date,
    MAX(r.business_date) AS last_business_date
  FROM business_revenue_facts_v2 r
  WHERE r.source_category='pos_retail_line' AND NULLIF(r.product_id,'') IS NOT NULL
  GROUP BY r.product_id
),
evidence AS (
  SELECT
    e.product_id,
    COUNT(*) FILTER (WHERE e.evidence_type='sale_snapshot')::INTEGER AS snapshot_evidence_count,
    COUNT(DISTINCT e.unit_cost) FILTER (WHERE e.evidence_type='sale_snapshot')::INTEGER AS snapshot_cost_count,
    MIN(e.unit_cost) FILTER (WHERE e.evidence_type='sale_snapshot')::NUMERIC(12,2) AS snapshot_cost_min,
    MAX(e.unit_cost) FILTER (WHERE e.evidence_type='sale_snapshot')::NUMERIC(12,2) AS snapshot_cost_max,
    MIN(e.evidence_date) FILTER (WHERE e.evidence_type='sale_snapshot') AS snapshot_observed_from,
    MAX(e.evidence_date) FILTER (WHERE e.evidence_type='sale_snapshot') AS snapshot_observed_to,
    COUNT(*) FILTER (WHERE e.evidence_type='alias_cost_snapshot')::INTEGER AS alias_evidence_count,
    COUNT(*) FILTER (WHERE e.evidence_type='current_master_cost')::INTEGER AS current_evidence_count
  FROM product_cost_evidence_v2 e
  GROUP BY e.product_id
),
base AS (
  SELECT
    cp.id AS product_id,
    cp.name AS product_name,
    cp.standard_name,
    cp.package_spec,
    cp.business_type_code,
    cp.is_beverage,
    cp.supplier,
    cp.cost_price::NUMERIC(12,2) AS current_cost,
    cp.retail_price::NUMERIC(12,2) AS retail_price,
    cp.approval_status,
    COALESCE(cp.is_active,true) AS is_active,
    (NULLIF(TRIM(cp.standard_name),'') IS NULL) AS missing_standard_name,
    (NULLIF(TRIM(cp.package_spec),'') IS NULL) AS missing_package_spec,
    (COALESCE(cp.business_type_code,'') NOT IN ('creative_retail','beverage_retail')) AS missing_business_type,
    (COALESCE(cp.business_type_code,'') IN ('creative_retail','beverage_retail')
      AND COALESCE(cp.is_beverage,false) <> (cp.business_type_code='beverage_retail')) AS beverage_classification_conflict,
    (COALESCE(cp.cost_price,0)<=0) AS missing_current_cost,
    COALESCE(s.sales_line_count,0) AS sales_line_count,
    COALESCE(s.affected_record_count,0) AS affected_record_count,
    COALESCE(s.sales_quantity,0)::NUMERIC(14,2) AS sales_quantity,
    COALESCE(s.affected_amount,0)::NUMERIC(14,2) AS affected_amount,
    s.first_business_date,
    s.last_business_date,
    COALESCE(e.snapshot_evidence_count,0) AS snapshot_evidence_count,
    COALESCE(e.snapshot_cost_count,0) AS snapshot_cost_count,
    e.snapshot_cost_min,
    e.snapshot_cost_max,
    e.snapshot_observed_from,
    e.snapshot_observed_to,
    COALESCE(e.alias_evidence_count,0) AS alias_evidence_count,
    COALESCE(e.current_evidence_count,0) AS current_evidence_count
  FROM creative_products cp
  LEFT JOIN sales s ON s.product_id=cp.id
  LEFT JOIN evidence e ON e.product_id=cp.id
  WHERE COALESCE(cp.is_active,true)=true
),
classified AS (
  SELECT b.*,
    (missing_standard_name::INTEGER + missing_package_spec::INTEGER + missing_business_type::INTEGER + beverage_classification_conflict::INTEGER)::INTEGER AS classification_issue_count,
    GREATEST(sales_line_count-snapshot_evidence_count,0)::INTEGER AS unverified_cost_line_count,
    CASE
      WHEN sales_line_count=0 AND COALESCE(current_cost,0)>0 THEN 'current_reference'
      WHEN sales_line_count=0 THEN 'no_sales_cost_missing'
      WHEN snapshot_evidence_count>=sales_line_count THEN 'verified_sale_snapshots'
      WHEN snapshot_evidence_count>0 THEN 'partial_sale_snapshots'
      WHEN alias_evidence_count>0 THEN 'alias_reference_requires_period'
      WHEN COALESCE(current_cost,0)>0 THEN 'current_only_no_backdate'
      ELSE 'cost_evidence_missing'
    END::TEXT AS cost_evidence_status
  FROM base b
)
SELECT
  'productgov_' || SUBSTRING(MD5(product_id),1,20) AS governance_id,
  product_id,product_name,standard_name,package_spec,business_type_code,is_beverage,supplier,
  current_cost,retail_price,approval_status,is_active,
  missing_standard_name,missing_package_spec,missing_business_type,beverage_classification_conflict,missing_current_cost,
  classification_issue_count,cost_evidence_status,
  sales_line_count,affected_record_count,sales_quantity,affected_amount,first_business_date,last_business_date,
  snapshot_evidence_count,unverified_cost_line_count,snapshot_cost_count,snapshot_cost_min,snapshot_cost_max,
  snapshot_observed_from,snapshot_observed_to,alias_evidence_count,current_evidence_count,
  CASE
    WHEN classification_issue_count>0 AND (unverified_cost_line_count>0 OR missing_current_cost) THEN 'classification_and_cost_review'
    WHEN unverified_cost_line_count>0 OR missing_current_cost THEN 'cost_evidence_review'
    WHEN classification_issue_count>0 THEN 'classification_review'
    ELSE 'complete'
  END::TEXT AS governance_status,
  CASE
    WHEN unverified_cost_line_count>0 THEN 'P1'
    WHEN missing_current_cost AND sales_line_count>0 THEN 'P1'
    WHEN classification_issue_count>0 AND sales_line_count>0 THEN 'P2'
    WHEN classification_issue_count>0 OR missing_current_cost THEN 'P3'
    ELSE 'P4'
  END::TEXT AS review_priority,
  CASE WHEN missing_standard_name THEN product_name ELSE standard_name END AS suggested_standard_name,
  CASE WHEN missing_business_type AND is_beverage=true THEN 'beverage_retail' ELSE business_type_code END AS suggested_business_type_code,
  CASE WHEN snapshot_cost_count=1 THEN snapshot_cost_min ELSE NULL END::NUMERIC(12,2) AS suggested_historical_unit_cost,
  CASE
    WHEN unverified_cost_line_count>0 AND snapshot_evidence_count=0 THEN '历史销售没有成交成本快照；当前成本和别名成本不能自动倒推'
    WHEN unverified_cost_line_count>0 THEN '仅部分历史销售有成交成本快照，剩余记录需补期间证据'
    WHEN missing_current_cost AND classification_issue_count>0 THEN '商品分类和当前成本均待补充证据'
    WHEN missing_current_cost THEN '商品当前成本缺失，需补采购、合同或供应商报价证据'
    WHEN classification_issue_count>0 THEN '标准名、规格、业务类型或饮料标记存在待补项'
    ELSE '商品分类完整，历史销售成本均有成交快照'
  END::TEXT AS review_note
FROM classified;

COMMIT;
