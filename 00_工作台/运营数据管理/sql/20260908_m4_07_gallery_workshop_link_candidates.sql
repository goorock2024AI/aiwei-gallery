-- M4-07: read-only candidates for historical gallery artwork links and
-- workshop project/direct-cost links. No source row or historical snapshot is changed.

BEGIN;

CREATE OR REPLACE VIEW gallery_link_candidates_v2 AS
WITH source_rows AS (
  SELECT g.*,
    direct_art.id AS direct_artwork_id,
    direct_art.title AS direct_artwork_title,
    direct_art.artist AS direct_artwork_artist,
    direct_art.artwork_no AS direct_artwork_no,
    direct_art.settlement_price AS direct_settlement_price,
    direct_art.updated_at AS direct_artwork_updated_at
  FROM gallery_sales g
  LEFT JOIN artworks direct_art ON direct_art.id=NULLIF(g.artwork_id,'')
  WHERE COALESCE(g.status,'')<>'已作废'
),
match_rows AS (
  SELECT s.id AS sale_id,a.id AS artwork_id,a.artwork_no,a.title,a.artist,
    a.settlement_price,a.retail_price,a.status AS artwork_status,a.approval_status,a.updated_at,
    evidence.match_tier,evidence.match_basis
  FROM source_rows s
  CROSS JOIN LATERAL (
    SELECT 0::INTEGER AS match_tier,'artwork_id'::TEXT AS match_basis
      WHERE s.direct_artwork_id IS NOT NULL
    UNION ALL
    SELECT 1,'artwork_no' WHERE s.direct_artwork_id IS NULL AND NULLIF(TRIM(s.artwork_no),'') IS NOT NULL
    UNION ALL
    SELECT 2,'title_artist' WHERE s.direct_artwork_id IS NULL AND NULLIF(TRIM(s.artwork_name),'') IS NOT NULL AND NULLIF(TRIM(s.artist),'') IS NOT NULL
    UNION ALL
    SELECT 3,'title_only' WHERE s.direct_artwork_id IS NULL AND NULLIF(TRIM(s.artwork_name),'') IS NOT NULL
  ) evidence
  JOIN artworks a ON
    (evidence.match_tier=0 AND a.id=s.direct_artwork_id)
    OR (evidence.match_tier=1 AND LOWER(TRIM(a.artwork_no))=LOWER(TRIM(s.artwork_no)))
    OR (evidence.match_tier=2 AND LOWER(TRIM(a.title))=LOWER(TRIM(s.artwork_name)) AND LOWER(TRIM(a.artist))=LOWER(TRIM(s.artist)))
    OR (evidence.match_tier=3 AND LOWER(TRIM(a.title))=LOWER(TRIM(s.artwork_name)))
),
ranked_matches AS (
  SELECT m.*,MIN(match_tier) OVER (PARTITION BY sale_id) AS best_tier
  FROM match_rows m
),
match_summary AS (
  SELECT sale_id,best_tier,
    COUNT(DISTINCT artwork_id)::INTEGER AS artwork_candidate_count,
    MIN(artwork_id) AS suggested_artwork_id,
    MIN(artwork_no) AS suggested_artwork_no,
    MIN(title) AS suggested_artwork_title,
    MIN(artist) AS suggested_artwork_artist,
    MIN(settlement_price)::NUMERIC AS current_settlement_reference,
    MIN(retail_price)::NUMERIC AS current_retail_reference,
    MIN(updated_at) AS reference_updated_at,
    MIN(match_basis) AS match_basis,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source','artworks','artworkId',artwork_id,'artworkNo',artwork_no,'title',title,'artist',artist,
      'matchBasis',match_basis,'settlementPrice',settlement_price,'retailPrice',retail_price,
      'artworkStatus',artwork_status,'approvalStatus',approval_status,'referenceUpdatedAt',updated_at
    ) ORDER BY artwork_no,artwork_id) AS candidate_options
  FROM ranked_matches
  WHERE match_tier=best_tier
  GROUP BY sale_id,best_tier
),
classified AS (
  SELECT s.*,COALESCE(m.artwork_candidate_count,0) AS artwork_candidate_count,
    m.best_tier,m.suggested_artwork_id,m.suggested_artwork_no,m.suggested_artwork_title,
    m.suggested_artwork_artist,m.current_settlement_reference,m.current_retail_reference,
    m.reference_updated_at,m.match_basis,COALESCE(m.candidate_options,'[]'::JSONB) AS candidate_options,
    CASE
      WHEN NULLIF(s.artwork_id,'') IS NOT NULL AND s.direct_artwork_id IS NULL THEN 'invalid_artwork_link'
      WHEN s.direct_artwork_id IS NOT NULL AND COALESCE(s.settlement_price_snapshot,0)>0 THEN 'linked_with_snapshot'
      WHEN s.direct_artwork_id IS NOT NULL THEN 'linked_missing_snapshot'
      WHEN COALESCE(m.artwork_candidate_count,0)>1 THEN 'ambiguous_artworks'
      WHEN COALESCE(m.artwork_candidate_count,0)=1 AND m.best_tier=1 THEN 'unique_artwork_no'
      WHEN COALESCE(m.artwork_candidate_count,0)=1 AND m.best_tier=2 THEN 'unique_title_artist'
      WHEN COALESCE(m.artwork_candidate_count,0)=1 THEN 'unique_title'
      ELSE 'no_artwork_candidate'
    END::TEXT AS candidate_status
  FROM source_rows s
  LEFT JOIN match_summary m ON m.sale_id=s.id
)
SELECT
  'gallerycand_' || SUBSTRING(MD5(CONCAT_WS('|','gallery_sales',id,'gallery_sale')),1,20) AS candidate_id,
  'gallery_sales'::TEXT AS source_table,id AS source_id,'gallery_sale'::TEXT AS source_line_key,
  date AS business_date,artwork_id AS original_artwork_id,artwork_no AS original_artwork_no,
  artwork_name AS original_artwork_name,artist AS original_artist,related_exhibition,
  sale_quantity,price AS original_price,commission,refund_amount,status,handler,
  COALESCE(NULLIF(gross_amount_snapshot,0),price*COALESCE(NULLIF(sale_quantity,0),1),0)::NUMERIC AS gross_amount,
  GREATEST(0,COALESCE(NULLIF(net_amount_snapshot,0),price*COALESCE(NULLIF(sale_quantity,0),1)-COALESCE(commission,0),0)-COALESCE(refund_amount,0))::NUMERIC AS realized_net_amount,
  settlement_price_snapshot,
  candidate_status,artwork_candidate_count,
  CASE WHEN artwork_candidate_count=1 THEN suggested_artwork_id ELSE '' END AS suggested_artwork_id,
  CASE WHEN artwork_candidate_count=1 THEN suggested_artwork_no ELSE '' END AS suggested_artwork_no,
  CASE WHEN artwork_candidate_count=1 THEN suggested_artwork_title ELSE '' END AS suggested_artwork_title,
  CASE WHEN artwork_candidate_count=1 THEN suggested_artwork_artist ELSE '' END AS suggested_artwork_artist,
  COALESCE(match_basis,'none') AS match_basis,
  CASE WHEN artwork_candidate_count=1 THEN
    CASE best_tier WHEN 0 THEN 1.00 WHEN 1 THEN 0.98 WHEN 2 THEN 0.90 ELSE 0.70 END
    ELSE 0 END::NUMERIC(5,2) AS confidence,
  candidate_options,
  CASE
    WHEN COALESCE(settlement_price_snapshot,0)>0 THEN 'frozen_snapshot'
    WHEN artwork_candidate_count=1 AND COALESCE(current_settlement_reference,0)>0 THEN 'current_master_reference'
    ELSE 'missing_evidence'
  END::TEXT AS settlement_evidence_status,
  CASE WHEN COALESCE(settlement_price_snapshot,0)>0 THEN settlement_price_snapshot ELSE COALESCE(current_settlement_reference,0) END::NUMERIC AS settlement_evidence_amount,
  CASE WHEN COALESCE(settlement_price_snapshot,0)>0 THEN created_at ELSE reference_updated_at END AS settlement_evidence_at,
  CASE WHEN candidate_status IN ('invalid_artwork_link','ambiguous_artworks','no_artwork_candidate') THEN 'P1'
       WHEN COALESCE(settlement_price_snapshot,0)=0 THEN 'P2'
       WHEN candidate_status IN ('unique_title','unique_title_artist','unique_artwork_no') THEN 'P3'
       ELSE 'P4' END::TEXT AS review_priority,
  (CASE candidate_status
    WHEN 'linked_with_snapshot' THEN '作品关联和成交时结算价快照完整'
    WHEN 'linked_missing_snapshot' THEN '作品已关联但缺成交时结算价快照，不得用当前价格直接回填历史'
    WHEN 'invalid_artwork_link' THEN '原作品 ID 已失效，需依据原编号或名称重新人工确认'
    WHEN 'unique_artwork_no' THEN '原作品编号精确命中唯一作品，可进入人工确认'
    WHEN 'unique_title_artist' THEN '原作品名和艺术家精确命中唯一作品，可进入人工确认'
    WHEN 'unique_title' THEN '仅作品名精确命中唯一作品，仍需人工核对艺术家和编号'
    WHEN 'ambiguous_artworks' THEN '最高等级证据命中多个作品，禁止自动关联'
    ELSE '没有精确作品候选，需人工查证作品档案'
  END || CASE
    WHEN COALESCE(settlement_price_snapshot,0)>0 THEN '；使用成交时冻结的结算价快照'
    WHEN artwork_candidate_count=1 AND COALESCE(current_settlement_reference,0)>0 THEN '；当前作品结算价仅作复核参考，不代表历史成交事实'
    ELSE '；缺少可验证的历史结算价证据'
  END)::TEXT AS review_note
FROM classified;

CREATE OR REPLACE VIEW workshop_link_candidates_v2 AS
WITH workshop_rows AS (
  SELECT fact_id,source_table,source_id,source_line_key,business_date,business_type_code,
    business_type_name,product_name_raw,quantity,unit_price,gross_amount,net_amount,
    project_name,handler,mapping_status,quality_flags,created_at
  FROM business_revenue_facts_v2
  WHERE source_table='revenue'
    AND business_layer_code='experience_activity'
    AND business_type_code IN ('workshop','course_study')
    AND source_category IN ('pos_workshop_line','pos_summary')
),
project_matches AS (
  SELECT w.fact_id,p.id AS project_id,p.name AS registered_project_name,p.status AS project_status,p.updated_at
  FROM workshop_rows w
  JOIN project_registry p
    ON COALESCE(p.status,'active') NOT IN ('inactive','archived','已归档','停用')
   AND LOWER(TRIM(p.name))=LOWER(TRIM(COALESCE(w.project_name,'')))
  WHERE NULLIF(TRIM(w.project_name),'') IS NOT NULL
),
project_summary AS (
  SELECT fact_id,COUNT(DISTINCT project_id)::INTEGER AS project_candidate_count,
    MIN(project_id) AS suggested_project_id,MIN(registered_project_name) AS suggested_project_name,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source','project_registry','projectId',project_id,'projectName',registered_project_name,
      'projectStatus',project_status,'referenceUpdatedAt',updated_at
    ) ORDER BY project_id) AS project_options
  FROM project_matches GROUP BY fact_id
),
cost_matches AS (
  SELECT w.fact_id,c.fact_id AS cost_fact_id,c.source_table AS cost_source_table,c.source_id AS cost_source_id,
    c.business_date AS cost_date,c.project_name AS cost_project_name,c.cost_type_code,c.cost_type_name,
    c.business_layer_code,c.business_type_code,c.capability_axis_code,c.cost_amount,c.mapping_status,
    CASE WHEN c.business_layer_code='experience_activity'
      AND c.cost_type_code='activity_execution'
      AND c.mapping_status NOT IN ('pending_review','unmatched_default')
      AND (NULLIF(c.business_type_code,'') IS NULL OR c.business_type_code=w.business_type_code)
      THEN true ELSE false END AS is_confirmed_direct
  FROM workshop_rows w
  JOIN business_cost_facts_v2 c
    ON c.cost_basis='period_expense'
   AND LEFT(c.business_date,7)=LEFT(w.business_date,7)
   AND NULLIF(TRIM(w.project_name),'') IS NOT NULL
   AND LOWER(TRIM(c.project_name))=LOWER(TRIM(w.project_name))
),
cost_summary AS (
  SELECT fact_id,COUNT(*)::INTEGER AS direct_cost_candidate_count,
    COUNT(*) FILTER (WHERE is_confirmed_direct)::INTEGER AS confirmed_direct_cost_count,
    COUNT(*) FILTER (WHERE NOT is_confirmed_direct)::INTEGER AS pending_direct_cost_count,
    COALESCE(SUM(cost_amount) FILTER (WHERE is_confirmed_direct),0)::NUMERIC AS confirmed_direct_cost_amount,
    COALESCE(SUM(cost_amount) FILTER (WHERE NOT is_confirmed_direct),0)::NUMERIC AS pending_direct_cost_amount,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'source',cost_source_table,'factId',cost_fact_id,'sourceId',cost_source_id,'businessDate',cost_date,
      'projectName',cost_project_name,'costTypeCode',cost_type_code,'costTypeName',cost_type_name,
      'businessLayerCode',business_layer_code,'businessTypeCode',business_type_code,
      'capabilityAxisCode',capability_axis_code,'costAmount',cost_amount,
      'mappingStatus',mapping_status,'confirmedDirect',is_confirmed_direct
    ) ORDER BY cost_date,cost_fact_id) AS direct_cost_options
  FROM cost_matches GROUP BY fact_id
),
classified AS (
  SELECT w.*,COALESCE(p.project_candidate_count,0) AS project_candidate_count,
    p.suggested_project_id,p.suggested_project_name,COALESCE(p.project_options,'[]'::JSONB) AS project_options,
    COALESCE(c.direct_cost_candidate_count,0) AS direct_cost_candidate_count,
    COALESCE(c.confirmed_direct_cost_count,0) AS confirmed_direct_cost_count,
    COALESCE(c.pending_direct_cost_count,0) AS pending_direct_cost_count,
    COALESCE(c.confirmed_direct_cost_amount,0)::NUMERIC AS confirmed_direct_cost_amount,
    COALESCE(c.pending_direct_cost_amount,0)::NUMERIC AS pending_direct_cost_amount,
    COALESCE(c.direct_cost_options,'[]'::JSONB) AS direct_cost_options
  FROM workshop_rows w
  LEFT JOIN project_summary p ON p.fact_id=w.fact_id
  LEFT JOIN cost_summary c ON c.fact_id=w.fact_id
)
SELECT
  'workshopcand_' || SUBSTRING(MD5(CONCAT_WS('|',source_table,source_id,source_line_key)),1,20) AS candidate_id,
  fact_id,source_table,source_id,source_line_key,business_date,business_type_code,business_type_name,
  product_name_raw AS activity_name,quantity AS participant_count,unit_price,gross_amount,net_amount AS affected_amount,
  project_name AS original_project_name,handler,mapping_status,quality_flags,
  CASE
    WHEN NULLIF(TRIM(project_name),'') IS NULL THEN 'missing_project'
    WHEN project_candidate_count>1 THEN 'ambiguous_projects'
    WHEN project_candidate_count=0 THEN 'unregistered_project'
    WHEN confirmed_direct_cost_count>0 AND pending_direct_cost_count=0 THEN 'ready_candidate'
    WHEN direct_cost_candidate_count>0 THEN 'cost_review'
    ELSE 'missing_direct_cost'
  END::TEXT AS candidate_status,
  project_candidate_count,
  CASE WHEN project_candidate_count=1 THEN suggested_project_id ELSE '' END AS suggested_project_id,
  CASE WHEN project_candidate_count=1 THEN suggested_project_name ELSE '' END AS suggested_project_name,
  CASE WHEN project_candidate_count=1 THEN 1.00 ELSE 0 END::NUMERIC(5,2) AS project_confidence,
  project_options,direct_cost_candidate_count,confirmed_direct_cost_count,pending_direct_cost_count,
  confirmed_direct_cost_amount,pending_direct_cost_amount,direct_cost_options,
  CASE WHEN NULLIF(TRIM(project_name),'') IS NULL OR project_candidate_count>1 THEN 'P1'
       WHEN project_candidate_count=0 OR pending_direct_cost_count>0 THEN 'P2'
       WHEN direct_cost_candidate_count=0 THEN 'P3'
       ELSE 'P4' END::TEXT AS review_priority,
  (CASE
    WHEN NULLIF(TRIM(project_name),'') IS NULL THEN '工坊收入明细缺项目名称，无法建立项目或直接成本候选'
    WHEN project_candidate_count>1 THEN '项目名称精确命中多个登记项目，必须人工选择'
    WHEN project_candidate_count=0 THEN '项目名称未命中项目登记，保留原项目文本待复核'
    ELSE '项目名称精确命中唯一登记项目'
  END || CASE
    WHEN confirmed_direct_cost_count>0 AND pending_direct_cost_count=0 THEN '；同月同项目的直接成本分类完整，可进入人工确认'
    WHEN direct_cost_candidate_count>0 THEN '；同月同项目存在待归类或非活动执行成本，只作为复核候选'
    ELSE '；未找到同月同项目的直接成本，不做估算或跨月分摊'
  END)::TEXT AS review_note
FROM classified;

COMMIT;
