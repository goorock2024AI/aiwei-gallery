-- M4-08: read-only candidates for historical space/cooperation classification.
-- The view explains missing or invalid business type, cooperation mode,
-- contract evidence and business status without changing source projects.

BEGIN;

CREATE OR REPLACE VIEW space_classification_candidates_v2 AS
WITH payment_summary AS (
  SELECT space_usage_id,
    COUNT(*)::INTEGER AS payment_count,
    COALESCE(SUM(amount),0)::NUMERIC AS received_amount,
    MIN(payment_date) AS first_payment_date,
    MAX(payment_date) AS latest_payment_date
  FROM space_payments
  GROUP BY space_usage_id
),
contract_counts AS (
  SELECT LOWER(TRIM(contract_no)) AS normalized_contract_no,
    COUNT(*)::INTEGER AS contract_usage_count
  FROM space_usage
  WHERE NULLIF(TRIM(contract_no),'') IS NOT NULL
  GROUP BY LOWER(TRIM(contract_no))
),
base AS (
  SELECT s.*,
    COALESCE(p.payment_count,0) AS payment_count,
    COALESCE(p.received_amount,0)::NUMERIC AS received_amount,
    p.first_payment_date,p.latest_payment_date,
    COALESCE(c.contract_usage_count,0) AS contract_usage_count,
    CASE
      WHEN s.type='场地租赁' THEN 'space_rental'
      WHEN s.type='长期经营' THEN 'space_rental'
      WHEN s.type='会议活动' THEN 'space_rental'
      WHEN s.type IN ('品牌快闪','企业团建','沙龙') THEN 'brand_event'
      ELSE 'uncategorized_revenue'
    END::TEXT AS suggested_business_type_code,
    CASE
      WHEN s.type='场地租赁' THEN 0.98
      WHEN s.type='品牌快闪' THEN 0.95
      WHEN s.type='长期经营' THEN 0.90
      WHEN s.type='会议活动' THEN 0.75
      WHEN s.type IN ('企业团建','沙龙') THEN 0.65
      ELSE 0
    END::NUMERIC(5,2) AS business_type_confidence,
    (s.type IN ('会议活动','企业团建','沙龙','展览') OR COALESCE(s.type,'')='') AS business_type_requires_review,
    CASE
      WHEN s.type IN ('场地租赁','长期经营') AND s.rental_type='付费' THEN '租赁'
      ELSE ''
    END::TEXT AS suggested_cooperation_mode,
    CASE
      WHEN s.type IN ('场地租赁','长期经营') AND s.rental_type='付费' THEN 0.95
      ELSE 0
    END::NUMERIC(5,2) AS cooperation_confidence,
    CASE COALESCE(s.status,'')
      WHEN '筹备中' THEN '洽谈'
      WHEN '已确认' THEN '已签约'
      WHEN '进行中' THEN '执行中'
      WHEN '已完成' THEN '已完成'
      WHEN '已取消' THEN '已取消'
      ELSE '待确认'
    END::TEXT AS suggested_business_status,
    CASE WHEN COALESCE(s.status,'') IN ('筹备中','已确认','进行中','已完成','已取消') THEN 0.95 ELSE 0 END::NUMERIC(5,2) AS business_status_confidence
  FROM space_usage s
  LEFT JOIN payment_summary p ON p.space_usage_id=s.id
  LEFT JOIN contract_counts c ON c.normalized_contract_no=LOWER(TRIM(s.contract_no))
),
dimension_status AS (
  SELECT b.*,
    CASE
      WHEN COALESCE(b.business_type_code,'') IN ('space_rental','brand_event') THEN 'confirmed'
      WHEN COALESCE(b.business_type_code,'')='uncategorized_revenue' THEN 'needs_review'
      WHEN NULLIF(TRIM(b.business_type_code),'') IS NOT NULL THEN 'invalid'
      WHEN b.business_type_requires_review OR b.suggested_business_type_code='uncategorized_revenue' THEN 'needs_review'
      ELSE 'suggested'
    END::TEXT AS business_type_status,
    CASE
      WHEN COALESCE(b.cooperation_mode,'') IN ('租赁','联办','赞助','置换','自营','其他') THEN 'confirmed'
      WHEN NULLIF(TRIM(b.cooperation_mode),'') IS NOT NULL THEN 'invalid'
      WHEN NULLIF(b.suggested_cooperation_mode,'') IS NOT NULL THEN 'suggested'
      ELSE 'needs_review'
    END::TEXT AS cooperation_status,
    CASE
      WHEN COALESCE(b.business_status,'') IN ('线索','洽谈','已签约','执行中','已完成','已取消') THEN 'confirmed'
      WHEN COALESCE(b.business_status,'')='待确认' THEN 'needs_review'
      WHEN NULLIF(TRIM(b.business_status),'') IS NOT NULL THEN 'invalid'
      WHEN b.suggested_business_status='待确认' THEN 'needs_review'
      ELSE 'suggested'
    END::TEXT AS business_status_status
  FROM base b
),
classified AS (
  SELECT d.*,
    CASE
      WHEN NULLIF(TRIM(d.contract_no),'') IS NOT NULL AND d.contract_usage_count>1 THEN 'duplicate'
      WHEN NULLIF(TRIM(d.contract_no),'') IS NOT NULL THEN 'present'
      WHEN d.rental_type='付费' AND COALESCE(NULLIF(d.business_status,''),d.suggested_business_status) IN ('已签约','执行中','已完成') THEN 'missing_required'
      WHEN d.rental_type='付费' THEN 'missing_review'
      ELSE 'not_required'
    END::TEXT AS contract_status
  FROM dimension_status d
),
scored AS (
  SELECT c.*,
    ((c.business_type_status<>'confirmed')::INTEGER
      +(c.cooperation_status<>'confirmed')::INTEGER
      +(c.business_status_status<>'confirmed')::INTEGER
      +(c.contract_status NOT IN ('present','not_required'))::INTEGER)::INTEGER AS issue_count
  FROM classified c
)
SELECT
  'spacecand_' || SUBSTRING(MD5(CONCAT_WS('|','space_usage',id,'space_project')),1,20) AS candidate_id,
  'space_usage'::TEXT AS source_table,id AS source_id,'space_project'::TEXT AS source_line_key,
  date AS business_date,NULLIF(end_date,'') AS end_date,space,project_name,type AS execution_type,
  client,status AS execution_status,rental_type,project_owner,notes,created_at,
  receivable_amount,received_amount,
  GREATEST(0,receivable_amount-received_amount)::NUMERIC AS outstanding_amount,
  payment_count,first_payment_date,latest_payment_date,
  business_layer_code AS original_business_layer_code,
  business_type_code AS original_business_type_code,
  cooperation_mode AS original_cooperation_mode,
  contract_no AS original_contract_no,
  business_status AS original_business_status,
  business_type_status,suggested_business_type_code,business_type_confidence,business_type_requires_review,
  cooperation_status,suggested_cooperation_mode,cooperation_confidence,
  contract_status,contract_usage_count,
  business_status_status,suggested_business_status,business_status_confidence,
  issue_count,
  CASE
    WHEN contract_status IN ('duplicate','missing_required','missing_review') THEN 'contract_review'
    WHEN business_type_status IN ('needs_review','invalid') OR business_status_status IN ('needs_review','invalid') THEN 'classification_review'
    WHEN cooperation_status IN ('needs_review','invalid') THEN 'cooperation_review'
    WHEN issue_count>0 THEN 'ready_candidate'
    ELSE 'complete'
  END::TEXT AS candidate_status,
  CASE
    WHEN contract_status IN ('duplicate','missing_required') OR business_type_status='invalid' OR business_status_status='invalid' OR cooperation_status='invalid' THEN 'P1'
    WHEN business_type_status='needs_review' OR cooperation_status='needs_review' OR business_status_status='needs_review' OR contract_status='missing_review' THEN 'P2'
    WHEN issue_count>0 THEN 'P3'
    ELSE 'P4'
  END::TEXT AS review_priority,
  JSONB_BUILD_OBJECT(
    'executionType',type,'executionStatus',status,'rentalType',rental_type,
    'receivableAmount',receivable_amount,'receivedAmount',received_amount,
    'paymentCount',payment_count,'contractUsageCount',contract_usage_count
  ) AS evidence,
  CONCAT_WS('；',
    CASE business_type_status
      WHEN 'confirmed' THEN NULL
      WHEN 'suggested' THEN '执行类型可生成唯一业务类型建议，仍需人工确认后应用'
      WHEN 'invalid' THEN '原业务类型不在有效字典中，需人工复核'
      ELSE '执行场景存在混合用途或缺少可靠映射，业务类型不得自动确定'
    END,
    CASE cooperation_status
      WHEN 'confirmed' THEN NULL
      WHEN 'suggested' THEN '付费租赁场景可建议合作方式为租赁，仍需人工确认'
      WHEN 'invalid' THEN '原合作方式不在有效字典中，需人工复核'
      ELSE '合作方式缺失且无法从现有字段可靠推断'
    END,
    CASE contract_status
      WHEN 'duplicate' THEN '合同编号在多个空间项目中重复，需核对真实合同关系'
      WHEN 'missing_required' THEN '付费且已签约、执行中或已完成的项目缺合同编号'
      WHEN 'missing_review' THEN '付费项目缺合同编号，需确认是否尚未签约或历史资料缺失'
      ELSE NULL
    END,
    CASE business_status_status
      WHEN 'confirmed' THEN NULL
      WHEN 'suggested' THEN '可依据执行状态生成经营状态建议，仍需人工确认'
      WHEN 'invalid' THEN '原经营状态不在有效字典中，需人工复核'
      ELSE '经营状态待确认，执行状态只作为复核证据'
    END,
    CASE WHEN issue_count=0 THEN '业务类型、合作方式、合同和经营状态信息完整' ELSE NULL END
  )::TEXT AS review_note
FROM scored;

COMMIT;
