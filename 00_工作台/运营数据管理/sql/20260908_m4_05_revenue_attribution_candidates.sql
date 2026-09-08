-- M4-05: reviewable historical revenue attribution candidates.
-- Suggestions are read-only; source revenue and mapping tables are not changed.

BEGIN;

CREATE OR REPLACE FUNCTION governance_safe_regex_match(input_value TEXT, pattern_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN COALESCE(input_value,'') ~* COALESCE(pattern_value,'');
EXCEPTION WHEN invalid_regular_expression THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE VIEW revenue_attribution_candidates_v2 AS
WITH unresolved AS (
  SELECT r.*
  FROM business_revenue_facts_v2 r
  WHERE r.business_type_code='uncategorized_revenue'
     OR r.mapping_status IN ('unmatched','pending_review','unmatched_default')
),
context_rows AS (
  SELECT u.fact_id,u.source_table,u.source_id,u.source_line_key,u.business_date,
    u.product_name_raw,u.product_name_standard,u.project_name,u.handler,u.payment_method,u.net_amount,
    ctx.field_name,ctx.field_value
  FROM unresolved u
  LEFT JOIN revenue rv ON u.source_table='revenue' AND rv.id=u.source_id
  LEFT JOIN transaction_adjustments ta ON u.source_table='transaction_adjustments' AND ta.id=u.source_id
  CROSS JOIN LATERAL (VALUES
    ('source_line_key'::TEXT,u.source_line_key),
    ('product_name_raw'::TEXT,u.product_name_raw),
    ('project_name'::TEXT,u.project_name),
    ('handler'::TEXT,u.handler),
    ('payment_method'::TEXT,u.payment_method),
    ('other_desc'::TEXT,CASE WHEN u.source_table='revenue' THEN rv.other_desc ELSE NULL END),
    ('reason'::TEXT,CASE WHEN u.source_table='transaction_adjustments' THEN ta.reason ELSE NULL END),
    ('action'::TEXT,CASE WHEN u.source_table='transaction_adjustments' THEN ta.action ELSE NULL END),
    (u.source_line_key,u.product_name_raw)
  ) ctx(field_name,field_value)
  WHERE NULLIF(TRIM(COALESCE(ctx.field_value,'')),'') IS NOT NULL
),
rule_matches AS (
  SELECT c.fact_id,br.id AS rule_id,br.source_field,br.match_type,br.match_value,
    c.field_value AS matched_value,br.business_layer_code,br.business_type_code,
    COALESCE(bt.parent_code,'') AS dimension_layer_code,
    bt.name AS business_type_name,bl.name AS business_layer_name,
    br.priority,br.confidence,br.notes,
    MAX(br.priority) OVER (PARTITION BY c.fact_id) AS top_priority
  FROM context_rows c
  JOIN business_mapping_rules br
    ON br.source_table=c.source_table
   AND br.source_field=c.field_name
   AND br.is_active=true
   AND NULLIF(br.business_type_code,'') IS NOT NULL
   AND br.business_type_code<>'uncategorized_revenue'
   AND (
     (br.match_type='field' AND (br.match_value=c.field_name OR br.match_value=c.source_line_key))
     OR (br.match_type='exact' AND LOWER(TRIM(c.field_value))=LOWER(TRIM(br.match_value)))
     OR (br.match_type='contains' AND c.field_value ILIKE ('%' || br.match_value || '%'))
     OR (br.match_type='prefix' AND c.field_value ILIKE (br.match_value || '%'))
     OR (br.match_type='suffix' AND c.field_value ILIKE ('%' || br.match_value))
     OR (br.match_type='regex' AND governance_safe_regex_match(c.field_value,br.match_value))
   )
  JOIN business_dimensions bt
    ON bt.dimension_type='business_type' AND bt.code=br.business_type_code AND bt.is_active=true
  LEFT JOIN business_dimensions bl
    ON bl.dimension_type='business_layer'
   AND bl.code=COALESCE(NULLIF(br.business_layer_code,''),bt.parent_code)
   AND bl.is_active=true
),
top_rule_summary AS (
  SELECT fact_id,
    COUNT(*)::INTEGER AS top_rule_count,
    COUNT(DISTINCT CONCAT_WS('|',COALESCE(NULLIF(business_layer_code,''),dimension_layer_code),business_type_code))::INTEGER AS top_destination_count,
    MIN(COALESCE(NULLIF(business_layer_code,''),dimension_layer_code)) AS suggested_business_layer_code,
    MIN(business_type_code) AS suggested_business_type_code,
    MIN(business_layer_name) AS suggested_business_layer_name,
    MIN(business_type_name) AS suggested_business_type_name,
    MAX(confidence)::NUMERIC(5,2) AS candidate_confidence,
    MAX(priority)::INTEGER AS candidate_priority,
    MIN(source_field) AS matched_field,
    MIN(matched_value) AS matched_value,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source','business_mapping_rules','ruleId',rule_id,'sourceField',source_field,
      'matchType',match_type,'matchValue',match_value,'matchedValue',matched_value,
      'businessLayerCode',COALESCE(NULLIF(business_layer_code,''),dimension_layer_code),
      'businessLayerName',business_layer_name,'businessTypeCode',business_type_code,
      'businessTypeName',business_type_name,'priority',priority,'confidence',confidence,'notes',notes
    ) ORDER BY confidence DESC,rule_id) AS candidate_options
  FROM rule_matches
  WHERE priority=top_priority
  GROUP BY fact_id
),
all_rule_counts AS (
  SELECT fact_id,COUNT(*)::INTEGER AS matched_rule_count FROM rule_matches GROUP BY fact_id
),
manual_links AS (
  SELECT u.fact_id,
    COUNT(l.id)::INTEGER AS manual_link_count,
    COUNT(DISTINCT CONCAT_WS('|',l.business_layer_code,l.business_type_code)) FILTER (
      WHERE NULLIF(l.business_type_code,'') IS NOT NULL AND l.business_type_code<>'uncategorized_revenue'
    )::INTEGER AS manual_destination_count,
    MIN(l.business_layer_code) FILTER (WHERE NULLIF(l.business_type_code,'') IS NOT NULL AND l.business_type_code<>'uncategorized_revenue') AS manual_business_layer_code,
    MIN(l.business_type_code) FILTER (WHERE NULLIF(l.business_type_code,'') IS NOT NULL AND l.business_type_code<>'uncategorized_revenue') AS manual_business_type_code,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source','record_business_links','linkId',l.id,'businessLayerCode',l.business_layer_code,
      'businessTypeCode',l.business_type_code,'mappingRuleId',l.mapping_rule_id,
      'overrideReason',l.override_reason,'createdBy',l.created_by
    ) ORDER BY l.updated_at DESC,l.id) FILTER (WHERE l.id IS NOT NULL) AS manual_options
  FROM unresolved u
  LEFT JOIN record_business_links l
    ON l.source_table=u.source_table AND l.source_id=u.source_id AND l.source_line_key=u.source_line_key
  GROUP BY u.fact_id
),
classified AS (
  SELECT u.*,COALESCE(m.manual_link_count,0) AS manual_link_count,
    COALESCE(m.manual_destination_count,0) AS manual_destination_count,
    m.manual_business_layer_code,m.manual_business_type_code,COALESCE(m.manual_options,'[]'::JSONB) AS manual_options,
    COALESCE(a.matched_rule_count,0) AS matched_rule_count,
    COALESCE(t.top_rule_count,0) AS top_rule_count,
    COALESCE(t.top_destination_count,0) AS top_destination_count,
    t.suggested_business_layer_code AS rule_business_layer_code,
    t.suggested_business_type_code AS rule_business_type_code,
    t.suggested_business_layer_name,t.suggested_business_type_name,
    t.candidate_confidence,t.candidate_priority,t.matched_field,t.matched_value,
    COALESCE(t.candidate_options,'[]'::JSONB) AS rule_options
  FROM unresolved u
  LEFT JOIN manual_links m ON m.fact_id=u.fact_id
  LEFT JOIN top_rule_summary t ON t.fact_id=u.fact_id
  LEFT JOIN all_rule_counts a ON a.fact_id=u.fact_id
)
SELECT
  'revenuecand_' || SUBSTRING(MD5(CONCAT_WS('|',source_table,source_id,COALESCE(source_line_key,''))),1,20) AS candidate_id,
  fact_id,source_table,source_id,source_line_key,business_date,
  COALESCE(NULLIF(product_name_standard,''),NULLIF(product_name_raw,''),NULLIF(project_name,''),'未命名收入') AS item_name,
  product_name_raw,project_name,handler,payment_method,net_amount AS affected_amount,
  CASE
    WHEN manual_destination_count>1 THEN 'ambiguous_manual_links'
    WHEN manual_destination_count=1 THEN 'manual_link'
    WHEN manual_link_count>0 THEN 'pending_manual_link'
    WHEN top_destination_count=1 THEN 'unique_rule'
    WHEN top_destination_count>1 THEN 'ambiguous_rules'
    ELSE 'no_candidate'
  END::TEXT AS candidate_status,
  CASE
    WHEN manual_link_count>0 THEN 'record_business_links'
    WHEN top_rule_count>0 THEN 'business_mapping_rules'
    ELSE 'none'
  END::TEXT AS candidate_basis,
  CASE WHEN manual_link_count>0 THEN manual_destination_count ELSE top_destination_count END::INTEGER AS candidate_count,
  manual_link_count,matched_rule_count,top_rule_count,candidate_priority,
  CASE WHEN manual_destination_count=1 THEN 1.00 ELSE COALESCE(candidate_confidence,0) END::NUMERIC(5,2) AS confidence,
  CASE WHEN manual_destination_count=1 THEN manual_business_layer_code WHEN manual_link_count=0 AND top_destination_count=1 THEN rule_business_layer_code ELSE '' END AS suggested_business_layer_code,
  CASE WHEN manual_destination_count=1 THEN manual_business_type_code WHEN manual_link_count=0 AND top_destination_count=1 THEN rule_business_type_code ELSE '' END AS suggested_business_type_code,
  CASE WHEN manual_link_count=0 AND top_destination_count=1 THEN suggested_business_layer_name ELSE '' END AS suggested_business_layer_name,
  CASE WHEN manual_link_count=0 AND top_destination_count=1 THEN suggested_business_type_name ELSE '' END AS suggested_business_type_name,
  CASE WHEN manual_link_count>0 THEN 'record_business_links' ELSE matched_field END AS matched_field,
  CASE WHEN manual_link_count>0 THEN source_line_key ELSE matched_value END AS matched_value,
  CASE WHEN manual_link_count>0 THEN manual_options ELSE rule_options END AS candidate_options,
  CASE
    WHEN manual_destination_count>1 THEN 'P1'
    WHEN top_destination_count>1 THEN 'P1'
    WHEN manual_link_count>0 AND manual_destination_count=0 THEN 'P1'
    WHEN top_destination_count=0 THEN 'P2'
    WHEN top_destination_count=1 THEN 'P3'
    ELSE 'P4'
  END::TEXT AS review_priority,
  CASE
    WHEN manual_destination_count>1 THEN '同一来源行存在冲突的人工链接，必须先人工清理'
    WHEN manual_destination_count=1 THEN '已有单条人工归属；等待后续批次让事实视图采用该解释'
    WHEN manual_link_count>0 THEN '已有人工链接但业务类型未完成，需补充确认'
    WHEN top_destination_count=1 THEN '最高优先级规则指向唯一业务类型，可进入人工确认'
    WHEN top_destination_count>1 THEN '最高优先级规则指向多个业务类型，禁止自动归属'
    ELSE '没有有效规则候选，需要创建单条人工链接或补充规则'
  END::TEXT AS review_note
FROM classified;

COMMIT;
