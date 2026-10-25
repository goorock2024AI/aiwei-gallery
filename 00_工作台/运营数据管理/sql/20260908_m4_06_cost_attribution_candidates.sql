-- M4-06: reviewable historical expense and cost attribution candidates.
-- Suggestions are read-only; the original expense category and source rows are preserved.

BEGIN;

CREATE OR REPLACE FUNCTION governance_safe_expense_regex_match(input_value TEXT, pattern_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN COALESCE(input_value,'') ~* COALESCE(pattern_value,'');
EXCEPTION WHEN invalid_regular_expression THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE VIEW cost_attribution_candidates_v2 AS
WITH expense_source AS (
  SELECT f.fact_id,f.source_table,f.source_id,f.source_line_key,f.business_date,
    f.cost_amount,f.project_name,f.handler,f.mapping_status,
    e.type AS original_type,e.project AS original_project,e.category AS original_category,
    e.description,e.related_activity,e.invoice_status,e.receipt_status,e.reimbursement_status
  FROM business_cost_facts_v2 f
  JOIN expense e ON f.source_table='expense' AND e.id=f.source_id
  WHERE f.source_line_key='expense'
),
context_rows AS (
  SELECT s.*,ctx.field_name,ctx.field_value
  FROM expense_source s
  CROSS JOIN LATERAL (VALUES
    ('project'::TEXT,s.original_project),
    ('related_activity'::TEXT,s.related_activity),
    ('category'::TEXT,s.original_category),
    ('description'::TEXT,s.description),
    ('handler'::TEXT,s.handler),
    ('type'::TEXT,s.original_type),
    ('source_line_key'::TEXT,s.source_line_key)
  ) ctx(field_name,field_value)
  WHERE NULLIF(TRIM(COALESCE(ctx.field_value,'')),'') IS NOT NULL
),
rule_matches AS (
  SELECT c.fact_id,br.id AS rule_id,br.source_field,br.match_type,br.match_value,
    c.field_value AS matched_value,
    COALESCE(NULLIF(br.business_layer_code,''),NULLIF(bt.parent_code,''),'') AS business_layer_code,
    COALESCE(br.business_type_code,'') AS business_type_code,
    COALESCE(br.cost_type_code,'') AS cost_type_code,
    COALESCE(br.capability_axis_code,'') AS capability_axis_code,
    br.priority,br.confidence,br.notes,
    MAX(br.priority) OVER (PARTITION BY c.fact_id) AS top_priority
  FROM context_rows c
  JOIN business_mapping_rules br
    ON br.source_table='expense'
   AND br.source_field=c.field_name
   AND br.is_active=true
   AND NULLIF(TRIM(br.match_value),'') IS NOT NULL
   AND (
     (br.match_type='field' AND (br.match_value=c.field_name OR br.match_value=c.source_line_key))
     OR (br.match_type='exact' AND LOWER(TRIM(c.field_value))=LOWER(TRIM(br.match_value)))
     OR (br.match_type='contains' AND c.field_value ILIKE ('%' || br.match_value || '%'))
     OR (br.match_type='prefix' AND c.field_value ILIKE (br.match_value || '%'))
     OR (br.match_type='suffix' AND c.field_value ILIKE ('%' || br.match_value))
     OR (br.match_type='regex' AND governance_safe_expense_regex_match(c.field_value,br.match_value))
   )
  LEFT JOIN business_dimensions bl
    ON bl.dimension_type='business_layer' AND bl.code=br.business_layer_code AND bl.is_active=true
  LEFT JOIN business_dimensions bt
    ON bt.dimension_type='business_type' AND bt.code=br.business_type_code AND bt.is_active=true
  LEFT JOIN business_dimensions ct
    ON ct.dimension_type='cost_type' AND ct.code=br.cost_type_code AND ct.is_active=true
  LEFT JOIN business_dimensions ca
    ON ca.dimension_type='capability_axis' AND ca.code=br.capability_axis_code AND ca.is_active=true
  WHERE (NULLIF(br.business_layer_code,'') IS NULL OR bl.code IS NOT NULL)
    AND (NULLIF(br.business_type_code,'') IS NULL OR bt.code IS NOT NULL)
    AND (NULLIF(br.cost_type_code,'') IS NULL OR (ct.code IS NOT NULL AND ct.code<>'uncategorized_cost'))
    AND (NULLIF(br.capability_axis_code,'') IS NULL OR ca.code IS NOT NULL)
    AND (bl.code IS NOT NULL OR bt.code IS NOT NULL OR (ct.code IS NOT NULL AND ct.code<>'uncategorized_cost') OR ca.code IS NOT NULL)
),
top_rule_summary AS (
  SELECT fact_id,
    COUNT(*)::INTEGER AS top_rule_count,
    COUNT(DISTINCT CONCAT_WS('|',business_layer_code,business_type_code,cost_type_code,capability_axis_code))::INTEGER AS rule_destination_count,
    COUNT(DISTINCT NULLIF(business_layer_code,''))::INTEGER AS layer_candidate_count,
    COUNT(DISTINCT NULLIF(business_type_code,''))::INTEGER AS type_candidate_count,
    COUNT(DISTINCT NULLIF(cost_type_code,''))::INTEGER AS cost_candidate_count,
    COUNT(DISTINCT NULLIF(capability_axis_code,''))::INTEGER AS capability_candidate_count,
    MIN(NULLIF(business_layer_code,'')) AS suggested_business_layer_code,
    MIN(NULLIF(business_type_code,'')) AS suggested_business_type_code,
    MIN(NULLIF(cost_type_code,'')) AS suggested_cost_type_code,
    MIN(NULLIF(capability_axis_code,'')) AS suggested_capability_axis_code,
    MAX(confidence)::NUMERIC(5,2) AS candidate_confidence,
    MAX(priority)::INTEGER AS candidate_priority,
    MIN(source_field) AS matched_field,
    MIN(matched_value) AS matched_value,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source','business_mapping_rules','ruleId',rule_id,'sourceField',source_field,
      'matchType',match_type,'matchValue',match_value,'matchedValue',matched_value,
      'businessLayerCode',business_layer_code,'businessTypeCode',business_type_code,
      'costTypeCode',cost_type_code,'capabilityAxisCode',capability_axis_code,
      'priority',priority,'confidence',confidence,'notes',notes
    ) ORDER BY confidence DESC,rule_id) AS candidate_options
  FROM rule_matches
  WHERE priority=top_priority
  GROUP BY fact_id
),
all_rule_counts AS (
  SELECT fact_id,COUNT(*)::INTEGER AS matched_rule_count FROM rule_matches GROUP BY fact_id
),
manual_links AS (
  SELECT s.fact_id,l.id AS manual_link_id,l.business_layer_code AS manual_business_layer_code,
    l.business_type_code AS manual_business_type_code,l.cost_type_code AS manual_cost_type_code,
    l.capability_axis_code AS manual_capability_axis_code,l.mapping_rule_id,l.override_reason,l.created_by,
    CASE WHEN l.id IS NULL THEN false
      WHEN ct.code IS NULL OR ct.code='uncategorized_cost' THEN false
      WHEN NULLIF(l.business_layer_code,'') IS NOT NULL AND bl.code IS NULL THEN false
      WHEN NULLIF(l.business_type_code,'') IS NOT NULL AND bt.code IS NULL THEN false
      WHEN NULLIF(l.capability_axis_code,'') IS NOT NULL AND ca.code IS NULL THEN false
      ELSE true END AS manual_valid
  FROM expense_source s
  LEFT JOIN record_business_links l
    ON l.source_table='expense' AND l.source_id=s.source_id AND l.source_line_key=s.source_line_key
  LEFT JOIN business_dimensions bl
    ON bl.dimension_type='business_layer' AND bl.code=l.business_layer_code AND bl.is_active=true
  LEFT JOIN business_dimensions bt
    ON bt.dimension_type='business_type' AND bt.code=l.business_type_code AND bt.is_active=true
  LEFT JOIN business_dimensions ct
    ON ct.dimension_type='cost_type' AND ct.code=l.cost_type_code AND ct.is_active=true
  LEFT JOIN business_dimensions ca
    ON ca.dimension_type='capability_axis' AND ca.code=l.capability_axis_code AND ca.is_active=true
),
project_match_rows AS (
  SELECT DISTINCT s.fact_id,p.id AS project_id,p.name AS project_name,
    CASE WHEN LOWER(TRIM(p.name))=LOWER(TRIM(s.original_project)) THEN 'project' ELSE 'related_activity' END AS matched_field,
    CASE WHEN LOWER(TRIM(p.name))=LOWER(TRIM(s.original_project)) THEN s.original_project ELSE s.related_activity END AS matched_value
  FROM expense_source s
  JOIN project_registry p
    ON COALESCE(p.status,'active') NOT IN ('inactive','archived','已归档','停用')
   AND (
     LOWER(TRIM(p.name))=LOWER(TRIM(COALESCE(s.original_project,'')))
     OR LOWER(TRIM(p.name))=LOWER(TRIM(COALESCE(s.related_activity,'')))
   )
  WHERE NULLIF(TRIM(p.name),'') IS NOT NULL
),
project_summary AS (
  SELECT fact_id,COUNT(DISTINCT project_id)::INTEGER AS project_candidate_count,
    MIN(project_id) AS suggested_project_id,MIN(project_name) AS suggested_project_name,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source','project_registry','projectId',project_id,'projectName',project_name,
      'matchedField',matched_field,'matchedValue',matched_value
    ) ORDER BY project_id) AS project_options
  FROM project_match_rows
  GROUP BY fact_id
),
classified AS (
  SELECT s.*,
    m.manual_link_id,m.manual_business_layer_code,m.manual_business_type_code,
    m.manual_cost_type_code,m.manual_capability_axis_code,m.mapping_rule_id,
    m.override_reason,m.created_by,COALESCE(m.manual_valid,false) AS manual_valid,
    COALESCE(a.matched_rule_count,0) AS matched_rule_count,
    COALESCE(t.top_rule_count,0) AS top_rule_count,
    COALESCE(t.rule_destination_count,0) AS rule_destination_count,
    COALESCE(t.layer_candidate_count,0) AS layer_candidate_count,
    COALESCE(t.type_candidate_count,0) AS type_candidate_count,
    COALESCE(t.cost_candidate_count,0) AS cost_candidate_count,
    COALESCE(t.capability_candidate_count,0) AS capability_candidate_count,
    t.suggested_business_layer_code AS rule_business_layer_code,
    t.suggested_business_type_code AS rule_business_type_code,
    t.suggested_cost_type_code AS rule_cost_type_code,
    t.suggested_capability_axis_code AS rule_capability_axis_code,
    t.candidate_confidence,t.candidate_priority,t.matched_field,t.matched_value,
    COALESCE(t.candidate_options,'[]'::JSONB) AS rule_options,
    COALESCE(p.project_candidate_count,0) AS project_candidate_count,
    p.suggested_project_id,p.suggested_project_name,COALESCE(p.project_options,'[]'::JSONB) AS project_options
  FROM expense_source s
  LEFT JOIN manual_links m ON m.fact_id=s.fact_id
  LEFT JOIN top_rule_summary t ON t.fact_id=s.fact_id
  LEFT JOIN all_rule_counts a ON a.fact_id=s.fact_id
  LEFT JOIN project_summary p ON p.fact_id=s.fact_id
),
resolved AS (
  SELECT c.*,
    CASE
      WHEN manual_link_id IS NOT NULL AND manual_valid THEN 'manual_link'
      WHEN manual_link_id IS NOT NULL THEN 'pending_manual_link'
      WHEN GREATEST(layer_candidate_count,type_candidate_count,cost_candidate_count,capability_candidate_count)>1 THEN 'ambiguous_rules'
      WHEN top_rule_count>0 AND cost_candidate_count=1 THEN 'unique_rule'
      WHEN top_rule_count>0 THEN 'partial_rule'
      ELSE 'no_candidate'
    END::TEXT AS candidate_status
  FROM classified c
)
SELECT
  'costcand_' || SUBSTRING(MD5(CONCAT_WS('|',source_table,source_id,COALESCE(source_line_key,''))),1,20) AS candidate_id,
  fact_id,source_table,source_id,source_line_key,business_date,
  original_type,original_project,original_category,description,related_activity,handler,
  invoice_status,receipt_status,reimbursement_status,cost_amount AS affected_amount,mapping_status,
  candidate_status,
  CASE WHEN manual_link_id IS NOT NULL THEN 'record_business_links'
       WHEN top_rule_count>0 THEN 'business_mapping_rules' ELSE 'none' END::TEXT AS candidate_basis,
  CASE WHEN manual_link_id IS NOT NULL THEN 1 ELSE rule_destination_count END::INTEGER AS candidate_count,
  matched_rule_count,top_rule_count,layer_candidate_count,type_candidate_count,cost_candidate_count,capability_candidate_count,
  candidate_priority,
  CASE WHEN candidate_status='manual_link' THEN 1.00 ELSE COALESCE(candidate_confidence,0) END::NUMERIC(5,2) AS confidence,
  CASE WHEN candidate_status='manual_link' THEN manual_business_layer_code WHEN candidate_status IN ('unique_rule','partial_rule') THEN COALESCE(rule_business_layer_code,'') ELSE '' END AS suggested_business_layer_code,
  CASE WHEN candidate_status='manual_link' THEN manual_business_type_code WHEN candidate_status IN ('unique_rule','partial_rule') THEN COALESCE(rule_business_type_code,'') ELSE '' END AS suggested_business_type_code,
  CASE WHEN candidate_status='manual_link' THEN manual_cost_type_code WHEN candidate_status='unique_rule' THEN COALESCE(rule_cost_type_code,'') ELSE '' END AS suggested_cost_type_code,
  CASE WHEN candidate_status='manual_link' THEN manual_capability_axis_code WHEN candidate_status IN ('unique_rule','partial_rule') THEN COALESCE(rule_capability_axis_code,'') ELSE '' END AS suggested_capability_axis_code,
  COALESCE(bl.name,'') AS suggested_business_layer_name,
  COALESCE(bt.name,'') AS suggested_business_type_name,
  COALESCE(ct.name,'') AS suggested_cost_type_name,
  COALESCE(ca.name,'') AS suggested_capability_axis_name,
  CASE WHEN manual_link_id IS NOT NULL THEN 'record_business_links' ELSE matched_field END AS matched_field,
  CASE WHEN manual_link_id IS NOT NULL THEN source_line_key ELSE matched_value END AS matched_value,
  CASE WHEN manual_link_id IS NOT NULL THEN JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
    'source','record_business_links','linkId',manual_link_id,'businessLayerCode',manual_business_layer_code,
    'businessTypeCode',manual_business_type_code,'costTypeCode',manual_cost_type_code,
    'capabilityAxisCode',manual_capability_axis_code,'mappingRuleId',mapping_rule_id,
    'overrideReason',override_reason,'createdBy',created_by
  )) ELSE rule_options END AS candidate_options,
  project_candidate_count,
  CASE
    WHEN COALESCE(NULLIF(TRIM(original_project),''),NULLIF(TRIM(related_activity),'')) IS NULL THEN 'not_applicable'
    WHEN LOWER(TRIM(COALESCE(original_project,''))) IN ('运营','日常运营','共享运营') AND NULLIF(TRIM(related_activity),'') IS NULL THEN 'not_applicable'
    WHEN project_candidate_count=1 THEN 'unique_project'
    WHEN project_candidate_count>1 THEN 'ambiguous_projects'
    ELSE 'unmatched_project'
  END::TEXT AS project_match_status,
  CASE WHEN project_candidate_count=1 THEN suggested_project_id ELSE '' END AS suggested_project_id,
  CASE WHEN project_candidate_count=1 THEN suggested_project_name ELSE '' END AS suggested_project_name,
  project_options,
  CASE
    WHEN candidate_status IN ('pending_manual_link','ambiguous_rules') OR project_candidate_count>1 THEN 'P1'
    WHEN candidate_status IN ('partial_rule','no_candidate') THEN 'P2'
    WHEN candidate_status='unique_rule' OR (project_candidate_count=0 AND LOWER(TRIM(COALESCE(original_project,''))) NOT IN ('','运营','日常运营','共享运营')) THEN 'P3'
    ELSE 'P4'
  END::TEXT AS review_priority,
  (CASE
    WHEN candidate_status='manual_link' THEN '已有有效人工成本归属；等待后续批次采用解释'
    WHEN candidate_status='pending_manual_link' THEN '已有人工链接但成本类型缺失、未归类或维度无效，需补充确认'
    WHEN candidate_status='ambiguous_rules' THEN '最高优先级规则在至少一个归属维度上冲突，禁止自动归类'
    WHEN candidate_status='unique_rule' THEN '最高优先级规则形成唯一成本类型候选，可进入人工确认'
    WHEN candidate_status='partial_rule' THEN '规则只提供部分归属维度，成本类型仍需人工确认'
    ELSE '没有有效归属规则，需要创建单条人工链接或补充规则'
  END || CASE
    WHEN project_candidate_count>1 THEN '；项目名称对应多个项目登记，需人工选择'
    WHEN project_candidate_count=1 THEN '；项目名称唯一匹配项目登记'
    WHEN COALESCE(NULLIF(TRIM(original_project),''),NULLIF(TRIM(related_activity),'')) IS NOT NULL
      AND NOT (LOWER(TRIM(COALESCE(original_project,''))) IN ('运营','日常运营','共享运营') AND NULLIF(TRIM(related_activity),'') IS NULL)
      THEN '；未找到同名项目登记，保留原项目文本待复核'
    ELSE '；本笔为共享或未指定项目'
  END)::TEXT AS review_note
FROM resolved r
LEFT JOIN business_dimensions bl ON bl.dimension_type='business_layer' AND bl.code=(CASE WHEN candidate_status='manual_link' THEN manual_business_layer_code WHEN candidate_status IN ('unique_rule','partial_rule') THEN rule_business_layer_code ELSE '' END)
LEFT JOIN business_dimensions bt ON bt.dimension_type='business_type' AND bt.code=(CASE WHEN candidate_status='manual_link' THEN manual_business_type_code WHEN candidate_status IN ('unique_rule','partial_rule') THEN rule_business_type_code ELSE '' END)
LEFT JOIN business_dimensions ct ON ct.dimension_type='cost_type' AND ct.code=(CASE WHEN candidate_status='manual_link' THEN manual_cost_type_code WHEN candidate_status='unique_rule' THEN rule_cost_type_code ELSE '' END)
LEFT JOIN business_dimensions ca ON ca.dimension_type='capability_axis' AND ca.code=(CASE WHEN candidate_status='manual_link' THEN manual_capability_axis_code WHEN candidate_status IN ('unique_rule','partial_rule') THEN rule_capability_axis_code ELSE '' END);

COMMIT;
