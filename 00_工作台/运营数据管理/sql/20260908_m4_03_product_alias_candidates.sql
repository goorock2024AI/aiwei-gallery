-- M4-03: historical retail alias candidates.
-- Read-only suggestions only. No alias or historical fact is modified.

BEGIN;

CREATE OR REPLACE VIEW product_alias_candidates_v2 AS
WITH historical AS (
  SELECT
    LOWER(REGEXP_REPLACE(TRIM(r.product_name_raw), '\\s+', '', 'g')) AS normalized_alias,
    MIN(TRIM(r.product_name_raw)) AS alias_name,
    ROUND(COALESCE(r.unit_price, 0)::NUMERIC, 2) AS unit_price,
    COUNT(*)::INTEGER AS line_count,
    COUNT(DISTINCT CONCAT_WS('|', r.source_table, r.source_id))::INTEGER AS affected_record_count,
    COALESCE(SUM(r.quantity), 0)::NUMERIC(14, 2) AS total_quantity,
    COALESCE(SUM(ABS(r.net_amount)), 0)::NUMERIC(14, 2) AS affected_amount,
    MIN(r.business_date) AS first_business_date,
    MAX(r.business_date) AS last_business_date,
    COUNT(*) FILTER (
      WHERE r.mapping_status IN ('sale_snapshot', 'alias_match')
         OR (r.mapping_status = 'manual_link' AND NULLIF(r.product_id, '') IS NOT NULL)
    )::INTEGER AS mapped_line_count,
    COUNT(*) FILTER (
      WHERE NOT (
        r.mapping_status IN ('sale_snapshot', 'alias_match')
        OR (r.mapping_status = 'manual_link' AND NULLIF(r.product_id, '') IS NOT NULL)
      )
    )::INTEGER AS review_line_count,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(r.product_id, '')), NULL) AS mapped_product_ids
  FROM business_revenue_facts_v2 r
  WHERE r.source_category = 'pos_retail_line'
    AND NULLIF(TRIM(r.product_name_raw), '') IS NOT NULL
  GROUP BY
    LOWER(REGEXP_REPLACE(TRIM(r.product_name_raw), '\\s+', '', 'g')),
    ROUND(COALESCE(r.unit_price, 0)::NUMERIC, 2)
),
alias_matches AS (
  SELECT
    h.normalized_alias,
    h.unit_price,
    COUNT(pa.id)::INTEGER AS alias_match_count,
    MAX(pa.confidence)::NUMERIC(5, 2) AS alias_confidence,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'source', 'product_aliases',
        'aliasId', pa.id,
        'productId', pa.standard_product_id,
        'standardName', pa.standard_name,
        'packageSpec', pa.package_spec,
        'businessTypeCode', pa.business_type_code,
        'referencePrice', pa.unit_price
      ) ORDER BY pa.confidence DESC, pa.updated_at DESC, pa.id
    ) AS alias_options
  FROM historical h
  JOIN product_aliases pa
    ON pa.is_active = true
   AND LOWER(REGEXP_REPLACE(TRIM(pa.alias_name), '\\s+', '', 'g')) = h.normalized_alias
   AND (pa.unit_price IS NULL OR ABS(pa.unit_price - h.unit_price) < 0.01)
  GROUP BY h.normalized_alias, h.unit_price
),
product_matches AS (
  SELECT
    h.normalized_alias,
    h.unit_price,
    COUNT(cp.id)::INTEGER AS name_match_count,
    COUNT(cp.id) FILTER (
      WHERE h.unit_price > 0
        AND cp.retail_price IS NOT NULL
        AND ABS(cp.retail_price - h.unit_price) < 0.01
    )::INTEGER AS price_match_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'source', 'creative_products',
        'productId', cp.id,
        'standardName', COALESCE(NULLIF(cp.standard_name, ''), cp.name),
        'packageSpec', cp.package_spec,
        'businessTypeCode', cp.business_type_code,
        'referencePrice', cp.retail_price
      ) ORDER BY cp.updated_at DESC, cp.id
    ) AS name_options,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'source', 'creative_products',
        'productId', cp.id,
        'standardName', COALESCE(NULLIF(cp.standard_name, ''), cp.name),
        'packageSpec', cp.package_spec,
        'businessTypeCode', cp.business_type_code,
        'referencePrice', cp.retail_price
      ) ORDER BY cp.updated_at DESC, cp.id
    ) FILTER (
      WHERE h.unit_price > 0
        AND cp.retail_price IS NOT NULL
        AND ABS(cp.retail_price - h.unit_price) < 0.01
    ) AS price_options
  FROM historical h
  JOIN creative_products cp
    ON COALESCE(cp.is_active, true) = true
   AND (
     LOWER(REGEXP_REPLACE(TRIM(cp.name), '\\s+', '', 'g')) = h.normalized_alias
     OR LOWER(REGEXP_REPLACE(TRIM(NULLIF(cp.standard_name, '')), '\\s+', '', 'g')) = h.normalized_alias
   )
  GROUP BY h.normalized_alias, h.unit_price
),
classified AS (
  SELECT
    h.*,
    COALESCE(a.alias_match_count, 0) AS alias_match_count,
    COALESCE(p.name_match_count, 0) AS name_match_count,
    COALESCE(p.price_match_count, 0) AS price_match_count,
    CASE
      WHEN COALESCE(a.alias_match_count, 0) > 1 THEN 'ambiguous'
      WHEN h.review_line_count = 0 AND CARDINALITY(h.mapped_product_ids) > 1 THEN 'ambiguous'
      WHEN h.review_line_count = 0 THEN 'matched'
      WHEN COALESCE(a.alias_match_count, 0) = 1 THEN 'matched'
      WHEN COALESCE(p.price_match_count, 0) = 1 THEN 'unique_candidate'
      WHEN COALESCE(p.price_match_count, 0) > 1 THEN 'ambiguous'
      WHEN COALESCE(p.name_match_count, 0) = 1 THEN 'unique_candidate'
      WHEN COALESCE(p.name_match_count, 0) > 1 THEN 'ambiguous'
      ELSE 'no_candidate'
    END::TEXT AS candidate_status,
    CASE
      WHEN COALESCE(a.alias_match_count, 0) = 1 THEN 'existing_alias'
      WHEN COALESCE(a.alias_match_count, 0) > 1 THEN 'multiple_aliases'
      WHEN h.review_line_count = 0 AND CARDINALITY(h.mapped_product_ids) > 1 THEN 'conflicting_historical_mappings'
      WHEN h.review_line_count = 0 THEN 'historical_mapping'
      WHEN COALESCE(p.price_match_count, 0) = 1 THEN 'exact_name_and_price'
      WHEN COALESCE(p.price_match_count, 0) > 1 THEN 'multiple_exact_name_and_price'
      WHEN COALESCE(p.name_match_count, 0) = 1 THEN 'exact_name'
      WHEN COALESCE(p.name_match_count, 0) > 1 THEN 'multiple_exact_names'
      ELSE 'no_exact_name'
    END::TEXT AS candidate_basis,
    CASE
      WHEN COALESCE(a.alias_match_count, 0) > 0 THEN a.alias_match_count
      WHEN h.review_line_count = 0 THEN CARDINALITY(h.mapped_product_ids)
      WHEN COALESCE(p.price_match_count, 0) > 0 THEN p.price_match_count
      ELSE COALESCE(p.name_match_count, 0)
    END::INTEGER AS candidate_count,
    CASE
      WHEN COALESCE(a.alias_match_count, 0) = 1 THEN COALESCE(a.alias_confidence, 1.00)
      WHEN COALESCE(a.alias_match_count, 0) > 1 THEN 0.50
      WHEN h.review_line_count = 0 AND CARDINALITY(h.mapped_product_ids) > 1 THEN 0.50
      WHEN h.review_line_count = 0 THEN 1.00
      WHEN COALESCE(p.price_match_count, 0) = 1 THEN 0.95
      WHEN COALESCE(p.price_match_count, 0) > 1 THEN 0.50
      WHEN COALESCE(p.name_match_count, 0) = 1 THEN 0.85
      WHEN COALESCE(p.name_match_count, 0) > 1 THEN 0.50
      ELSE 0.00
    END::NUMERIC(5, 2) AS confidence,
    CASE
      WHEN COALESCE(a.alias_match_count, 0) > 0 THEN a.alias_options
      WHEN h.review_line_count = 0 THEN COALESCE(
        (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('source','historical_mapping','productId',x)) FROM UNNEST(h.mapped_product_ids) x),
        '[]'::JSONB
      )
      WHEN COALESCE(p.price_match_count, 0) > 0 THEN p.price_options
      ELSE COALESCE(p.name_options, '[]'::JSONB)
    END AS candidate_options
  FROM historical h
  LEFT JOIN alias_matches a USING (normalized_alias, unit_price)
  LEFT JOIN product_matches p USING (normalized_alias, unit_price)
)
SELECT
  'aliascand_' || SUBSTRING(MD5(CONCAT_WS('|', normalized_alias, unit_price::TEXT)), 1, 20) AS candidate_id,
  normalized_alias,
  alias_name,
  unit_price,
  line_count,
  affected_record_count,
  total_quantity,
  affected_amount,
  first_business_date,
  last_business_date,
  mapped_line_count,
  review_line_count,
  candidate_status,
  candidate_basis,
  candidate_count,
  confidence,
  CASE WHEN candidate_count = 1 THEN candidate_options->0->>'productId' ELSE '' END AS suggested_product_id,
  CASE WHEN candidate_count = 1 THEN candidate_options->0->>'standardName' ELSE '' END AS suggested_standard_name,
  CASE WHEN candidate_count = 1 THEN candidate_options->0->>'packageSpec' ELSE '' END AS suggested_package_spec,
  CASE WHEN candidate_count = 1 THEN candidate_options->0->>'businessTypeCode' ELSE '' END AS suggested_business_type_code,
  candidate_options,
  CASE candidate_status
    WHEN 'matched' THEN '已有可追溯映射，无需新增别名'
    WHEN 'unique_candidate' THEN '精确同名且候选唯一，等待人工确认'
    WHEN 'ambiguous' THEN '存在多个精确同名候选，必须人工选择'
    ELSE '没有精确同名候选，等待补充商品主数据或人工判断'
  END::TEXT AS review_note
FROM classified;

COMMIT;
