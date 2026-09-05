-- M3-02: 2.0 business fact views.
-- Run after:
--   1) 20260903_m3_02_business_dimensions.sql
--   2) 20260903_m3_02_product_gallery_space_extensions.sql

CREATE OR REPLACE VIEW business_revenue_facts_v2 AS
WITH retail_lines AS (
  SELECT
    r.id AS revenue_id,
    ('retail:' || item.ord::TEXT) AS source_line_key,
    r.date AS business_date,
    COALESCE(item.value->>'product_name', item.value->>'productName', item.value->>'name', item.value->>'title', '') AS product_name_raw,
    CASE
      WHEN COALESCE(item.value->>'qty', item.value->>'quantity', item.value->>'count', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN COALESCE(item.value->>'qty', item.value->>'quantity', item.value->>'count')::NUMERIC
      ELSE 1
    END AS quantity,
    CASE
      WHEN COALESCE(item.value->>'unit_price', item.value->>'unitPrice', item.value->>'price', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN COALESCE(item.value->>'unit_price', item.value->>'unitPrice', item.value->>'price')::NUMERIC
      ELSE 0
    END AS unit_price,
    CASE
      WHEN COALESCE(item.value->>'amount', item.value->>'total', item.value->>'subtotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN COALESCE(item.value->>'amount', item.value->>'total', item.value->>'subtotal')::NUMERIC
      ELSE NULL
    END AS line_amount,
    r.payment_method,
    r.project_name,
    r.handler,
    r.created_at
  FROM revenue r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(r.retail_items) = 'array' THEN r.retail_items
      ELSE '[]'::JSONB
    END
  ) WITH ORDINALITY AS item(value, ord)
  WHERE COALESCE(r.status, '') <> '已作废'
),
workshop_lines AS (
  SELECT
    r.id AS revenue_id,
    ('workshop:' || item.ord::TEXT) AS source_line_key,
    r.date AS business_date,
    COALESCE(item.value->>'product_name', item.value->>'productName', item.value->>'name', item.value->>'title', '工坊/体验') AS product_name_raw,
    CASE
      WHEN COALESCE(item.value->>'qty', item.value->>'quantity', item.value->>'count', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN COALESCE(item.value->>'qty', item.value->>'quantity', item.value->>'count')::NUMERIC
      ELSE 1
    END AS quantity,
    CASE
      WHEN COALESCE(item.value->>'unit_price', item.value->>'unitPrice', item.value->>'price', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN COALESCE(item.value->>'unit_price', item.value->>'unitPrice', item.value->>'price')::NUMERIC
      ELSE 0
    END AS unit_price,
    CASE
      WHEN COALESCE(item.value->>'amount', item.value->>'total', item.value->>'subtotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN COALESCE(item.value->>'amount', item.value->>'total', item.value->>'subtotal')::NUMERIC
      ELSE NULL
    END AS line_amount,
    r.payment_method,
    r.project_name,
    r.handler,
    r.created_at
  FROM revenue r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(r.workshop_items) = 'array' THEN r.workshop_items
      ELSE '[]'::JSONB
    END
  ) WITH ORDINALITY AS item(value, ord)
  WHERE COALESCE(r.status, '') <> '已作废'
),
raw_revenue_facts AS (
  SELECT
    ('revenue:' || r.id || ':ticket') AS fact_id,
    'revenue'::TEXT AS source_table,
    r.id AS source_id,
    'ticket'::TEXT AS source_line_key,
    r.date AS business_date,
    'pos_summary'::TEXT AS source_category,
    'visit'::TEXT AS business_layer_code,
    'ticket'::TEXT AS business_type_code,
    ''::TEXT AS product_id,
    '门票'::TEXT AS product_name_raw,
    '门票'::TEXT AS product_name_standard,
    ''::TEXT AS package_spec,
    CASE WHEN COALESCE(r.ticket_qty, 0) <> 0 THEN COALESCE(r.ticket_amount, 0) / NULLIF(r.ticket_qty, 0) ELSE 0 END AS unit_price,
    COALESCE(r.ticket_qty, 0)::NUMERIC AS quantity,
    0::NUMERIC AS unit_cost,
    COALESCE(r.ticket_amount, 0)::NUMERIC AS gross_amount,
    COALESCE(r.ticket_amount, 0)::NUMERIC AS net_amount,
    r.payment_method,
    r.project_name,
    r.handler,
    false AS is_beverage,
    false AS is_manual_override,
    'system_field'::TEXT AS mapping_status,
    '{}'::JSONB AS quality_flags,
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废' AND COALESCE(r.ticket_amount, 0) <> 0

  UNION ALL

  SELECT
    ('revenue:' || r.id || ':combo') AS fact_id,
    'revenue',
    r.id,
    'combo',
    r.date,
    'pos_summary',
    'visit',
    'visit_combo',
    '',
    '到馆套票',
    '到馆套票',
    '',
    CASE WHEN COALESCE(r.combo_qty, 0) <> 0 THEN COALESCE(r.combo_amount, 0) / NULLIF(r.combo_qty, 0) ELSE 0 END,
    COALESCE(r.combo_qty, 0)::NUMERIC,
    0::NUMERIC,
    COALESCE(r.combo_amount, 0)::NUMERIC,
    COALESCE(r.combo_amount, 0)::NUMERIC,
    r.payment_method,
    r.project_name,
    r.handler,
    false,
    false,
    'system_field',
    '{}'::JSONB,
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废' AND COALESCE(r.combo_amount, 0) <> 0

  UNION ALL

  SELECT
    ('revenue:' || r.id || ':coffee') AS fact_id,
    'revenue',
    r.id,
    'coffee',
    r.date,
    'pos_summary',
    'onsite_consumption',
    'coffee',
    '',
    '咖啡',
    '咖啡',
    '',
    CASE WHEN COALESCE(r.coffee_qty, 0) <> 0 THEN COALESCE(r.coffee_amount, 0) / NULLIF(r.coffee_qty, 0) ELSE 0 END,
    COALESCE(r.coffee_qty, 0)::NUMERIC,
    0::NUMERIC,
    COALESCE(r.coffee_amount, 0)::NUMERIC,
    COALESCE(r.coffee_amount, 0)::NUMERIC,
    r.payment_method,
    r.project_name,
    r.handler,
    false,
    false,
    'system_field',
    '{}'::JSONB,
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废' AND COALESCE(r.coffee_amount, 0) <> 0

  UNION ALL

  SELECT
    ('revenue:' || rl.revenue_id || ':' || rl.source_line_key) AS fact_id,
    'revenue',
    rl.revenue_id,
    rl.source_line_key,
    rl.business_date,
    'pos_retail_line',
    COALESCE(NULLIF(link.business_layer_code, ''), 'onsite_consumption'),
    COALESCE(
      NULLIF(link.business_type_code, ''),
      NULLIF(pa.business_type_code, ''),
      NULLIF(cp.business_type_code, ''),
      CASE WHEN COALESCE(pa.is_beverage, cp.is_beverage, false) THEN 'beverage_retail' ELSE 'creative_retail' END
    ),
    COALESCE(NULLIF(link.product_id, ''), NULLIF(pa.standard_product_id, ''), cp.id, ''),
    rl.product_name_raw,
    COALESCE(NULLIF(pa.standard_name, ''), NULLIF(cp.standard_name, ''), NULLIF(cp.name, ''), rl.product_name_raw),
    COALESCE(NULLIF(pa.package_spec, ''), NULLIF(cp.package_spec, ''), ''),
    rl.unit_price,
    rl.quantity,
    COALESCE(pa.cost_price_snapshot, cp.cost_price, 0),
    COALESCE(rl.line_amount, rl.quantity * rl.unit_price, 0),
    COALESCE(rl.line_amount, rl.quantity * rl.unit_price, 0),
    rl.payment_method,
    rl.project_name,
    rl.handler,
    COALESCE(pa.is_beverage, cp.is_beverage, false),
    (link.id IS NOT NULL),
    CASE
      WHEN link.id IS NOT NULL THEN 'manual_link'
      WHEN pa.id IS NOT NULL THEN 'alias_match'
      WHEN cp.id IS NOT NULL THEN 'product_match'
      ELSE 'unmatched_default'
    END,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_product_name', CASE WHEN NULLIF(rl.product_name_raw, '') IS NULL THEN true ELSE NULL END,
      'missing_cost', CASE WHEN COALESCE(pa.cost_price_snapshot, cp.cost_price, 0) = 0 THEN true ELSE NULL END
    )),
    rl.created_at
  FROM retail_lines rl
  LEFT JOIN record_business_links link
    ON link.source_table = 'revenue'
   AND link.source_id = rl.revenue_id
   AND link.source_line_key = rl.source_line_key
  LEFT JOIN LATERAL (
    SELECT pa.*
    FROM product_aliases pa
    WHERE pa.is_active = true
      AND lower(pa.alias_name) = lower(rl.product_name_raw)
      AND (
        pa.unit_price IS NULL
        OR abs(pa.unit_price - rl.unit_price) < 0.01
      )
    ORDER BY
      CASE WHEN pa.unit_price IS NOT NULL AND abs(pa.unit_price - rl.unit_price) < 0.01 THEN 0 ELSE 1 END,
      pa.confidence DESC,
      pa.created_at DESC
    LIMIT 1
  ) pa ON true
  LEFT JOIN LATERAL (
    SELECT cp.*
    FROM creative_products cp
    WHERE COALESCE(cp.is_active, true) = true
      AND (
        lower(cp.name) = lower(rl.product_name_raw)
        OR lower(NULLIF(cp.standard_name, '')) = lower(rl.product_name_raw)
      )
    ORDER BY
      CASE WHEN lower(cp.name) = lower(rl.product_name_raw) THEN 0 ELSE 1 END,
      cp.updated_at DESC
    LIMIT 1
  ) cp ON true

  UNION ALL

  SELECT
    ('revenue:' || wl.revenue_id || ':' || wl.source_line_key) AS fact_id,
    'revenue',
    wl.revenue_id,
    wl.source_line_key,
    wl.business_date,
    'pos_workshop_line',
    COALESCE(NULLIF(link.business_layer_code, ''), 'experience_activity'),
    COALESCE(NULLIF(link.business_type_code, ''), 'workshop'),
    COALESCE(NULLIF(link.product_id, ''), ''),
    wl.product_name_raw,
    wl.product_name_raw,
    '',
    wl.unit_price,
    wl.quantity,
    0::NUMERIC,
    COALESCE(wl.line_amount, wl.quantity * wl.unit_price, 0),
    COALESCE(wl.line_amount, wl.quantity * wl.unit_price, 0),
    wl.payment_method,
    wl.project_name,
    wl.handler,
    false,
    (link.id IS NOT NULL),
    CASE WHEN link.id IS NOT NULL THEN 'manual_link' ELSE 'system_field' END,
    '{}'::JSONB,
    wl.created_at
  FROM workshop_lines wl
  LEFT JOIN record_business_links link
    ON link.source_table = 'revenue'
   AND link.source_id = wl.revenue_id
   AND link.source_line_key = wl.source_line_key

  UNION ALL

  SELECT
    ('revenue:' || r.id || ':workshop_amount') AS fact_id,
    'revenue',
    r.id,
    'workshop_amount',
    r.date,
    'pos_summary',
    'experience_activity',
    'workshop',
    '',
    '工坊/体验',
    '工坊/体验',
    '',
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    COALESCE(r.workshop_amount, 0)::NUMERIC,
    COALESCE(r.workshop_amount, 0)::NUMERIC,
    r.payment_method,
    r.project_name,
    r.handler,
    false,
    false,
    'legacy_summary',
    jsonb_build_object('legacy_summary_without_items', true),
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废'
    AND COALESCE(r.workshop_amount, 0) <> 0
    AND jsonb_array_length(CASE WHEN jsonb_typeof(r.workshop_items) = 'array' THEN r.workshop_items ELSE '[]'::JSONB END) = 0

  UNION ALL

  SELECT
    ('revenue:' || r.id || ':retail_amount') AS fact_id,
    'revenue',
    r.id,
    'retail_amount',
    r.date,
    'pos_summary',
    'onsite_consumption',
    'creative_retail',
    '',
    '文创零售',
    '文创零售',
    '',
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    COALESCE(r.retail_amount, 0)::NUMERIC + COALESCE(r.creative_amount, 0)::NUMERIC,
    COALESCE(r.retail_amount, 0)::NUMERIC + COALESCE(r.creative_amount, 0)::NUMERIC,
    r.payment_method,
    r.project_name,
    r.handler,
    false,
    false,
    'legacy_summary',
    jsonb_build_object('legacy_summary_without_items', true),
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废'
    AND COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) <> 0
    AND jsonb_array_length(CASE WHEN jsonb_typeof(r.retail_items) = 'array' THEN r.retail_items ELSE '[]'::JSONB END) = 0

  UNION ALL

  SELECT
    ('revenue:' || r.id || ':venue_amount') AS fact_id,
    'revenue',
    r.id,
    'venue_amount',
    r.date,
    'pos_summary',
    'art_transaction_cooperation',
    'space_rental',
    '',
    '场地旧口径',
    '场地旧口径',
    '',
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    COALESCE(r.venue_amount, 0)::NUMERIC,
    COALESCE(r.venue_amount, 0)::NUMERIC,
    r.payment_method,
    r.project_name,
    r.handler,
    false,
    false,
    'legacy_summary',
    jsonb_build_object('legacy_venue_amount', true),
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废'
    AND COALESCE(r.venue_amount, 0) <> 0

  UNION ALL

  SELECT
    ('revenue:' || r.id || ':other_amount') AS fact_id,
    'revenue',
    r.id,
    'other_amount',
    r.date,
    'pos_summary',
    '',
    'uncategorized_revenue',
    '',
    COALESCE(NULLIF(r.other_desc, ''), '其他收入'),
    COALESCE(NULLIF(r.other_desc, ''), '其他收入'),
    '',
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    COALESCE(r.other_amount, 0)::NUMERIC,
    COALESCE(r.other_amount, 0)::NUMERIC,
    r.payment_method,
    r.project_name,
    r.handler,
    false,
    false,
    'legacy_summary',
    jsonb_build_object('legacy_other_amount', true),
    r.created_at
  FROM revenue r
  WHERE COALESCE(r.status, '') <> '已作废'
    AND COALESCE(r.other_amount, 0) <> 0

  UNION ALL

  SELECT
    ('gallery_sales:' || g.id) AS fact_id,
    'gallery_sales',
    g.id,
    'gallery_sale',
    g.date,
    'gallery_sale',
    'art_transaction_cooperation',
    COALESCE(NULLIF(g.business_type_code, ''), 'gallery_sale'),
    COALESCE(NULLIF(g.artwork_id, ''), ''),
    COALESCE(NULLIF(g.artwork_name, ''), NULLIF(g.artwork_no, ''), '作品销售'),
    COALESCE(NULLIF(g.artwork_name, ''), NULLIF(a.title, ''), NULLIF(g.artwork_no, ''), '作品销售'),
    COALESCE(NULLIF(g.gallery_channel, ''), ''),
    CASE WHEN COALESCE(g.sale_quantity, 0) <> 0 THEN COALESCE(NULLIF(g.gross_amount_snapshot, 0), g.price, 0) / NULLIF(g.sale_quantity, 0) ELSE COALESCE(NULLIF(g.gross_amount_snapshot, 0), g.price, 0) END,
    COALESCE(NULLIF(g.sale_quantity, 0), 1)::NUMERIC,
    COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0)::NUMERIC,
    COALESCE(NULLIF(g.gross_amount_snapshot, 0), g.price, 0)::NUMERIC,
    COALESCE(NULLIF(g.net_amount_snapshot, 0), g.price - COALESCE(g.commission, 0) - COALESCE(g.refund_amount, 0), 0)::NUMERIC,
    g.payment_method,
    COALESCE(NULLIF(g.related_exhibition, ''), '画廊'),
    g.handler,
    false,
    false,
    'system_field',
    '{}'::JSONB,
    g.created_at
  FROM gallery_sales g
  LEFT JOIN artworks a
    ON a.id = g.artwork_id
    OR (NULLIF(g.artwork_id, '') IS NULL AND a.artwork_no = g.artwork_no)
  WHERE COALESCE(g.status, '') <> '已作废'

  UNION ALL

  SELECT
    ('space_payments:' || sp.id) AS fact_id,
    'space_payments',
    sp.id,
    'space_payment',
    sp.payment_date,
    'space_payment',
    COALESCE(NULLIF(s.business_layer_code, ''), 'art_transaction_cooperation'),
    COALESCE(
      NULLIF(s.business_type_code, ''),
      NULLIF(rule.business_type_code, ''),
      CASE WHEN COALESCE(s.type, '') LIKE '%品牌%' THEN 'brand_event' ELSE 'space_rental' END
    ),
    '',
    COALESCE(NULLIF(s.project_name, ''), NULLIF(s.space, ''), '空间合作'),
    COALESCE(NULLIF(s.project_name, ''), NULLIF(s.space, ''), '空间合作'),
    COALESCE(NULLIF(s.cooperation_mode, ''), ''),
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    COALESCE(sp.amount, 0)::NUMERIC,
    COALESCE(sp.amount, 0)::NUMERIC,
    sp.payment_method,
    s.project_name,
    '',
    false,
    false,
    CASE WHEN rule.id IS NOT NULL THEN 'rule_match' ELSE 'system_default' END,
    '{}'::JSONB,
    sp.created_at
  FROM space_payments sp
  JOIN space_usage s ON s.id = sp.space_usage_id
  LEFT JOIN LATERAL (
    SELECT br.*
    FROM business_mapping_rules br
    WHERE br.source_table = 'space_usage'
      AND br.source_field = 'type'
      AND br.is_active = true
      AND (
        (br.match_type = 'exact' AND br.match_value = s.type)
        OR (br.match_type = 'contains' AND s.type ILIKE ('%' || br.match_value || '%'))
      )
    ORDER BY br.priority DESC, br.confidence DESC
    LIMIT 1
  ) rule ON true
  WHERE s.rental_type = '付费'
    AND COALESCE(sp.amount, 0) <> 0

  UNION ALL

  SELECT
    ('transaction_adjustments:' || a.id) AS fact_id,
    'transaction_adjustments',
    a.id,
    'adjustment',
    TO_CHAR(a.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
    'transaction_adjustment',
    '',
    'uncategorized_revenue',
    '',
    CASE
      WHEN a.action = 'refund' THEN '退款'
      WHEN a.action = 'partial_refund' THEN '部分退款'
      ELSE '调整'
    END,
    CASE
      WHEN a.action = 'refund' THEN '退款'
      WHEN a.action = 'partial_refund' THEN '部分退款'
      ELSE '调整'
    END,
    '',
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    -ABS(COALESCE(a.amount, 0))::NUMERIC,
    -ABS(COALESCE(a.amount, 0))::NUMERIC,
    '',
    '',
    a.operator_name,
    false,
    false,
    'system_field',
    jsonb_build_object('transaction_adjustment', true, 'action', a.action),
    a.created_at
  FROM transaction_adjustments a
  WHERE a.action IN ('refund', 'partial_refund')
    AND COALESCE(a.amount, 0) <> 0
)
SELECT
  rf.fact_id,
  rf.source_table,
  rf.source_id,
  rf.source_line_key,
  rf.business_date,
  rf.source_category,
  rf.business_layer_code,
  COALESCE(layer_dim.name, rf.business_layer_code) AS business_layer_name,
  rf.business_type_code,
  COALESCE(type_dim.name, rf.business_type_code) AS business_type_name,
  rf.product_id,
  rf.product_name_raw,
  rf.product_name_standard,
  rf.package_spec,
  rf.unit_price,
  rf.quantity,
  rf.unit_cost,
  rf.gross_amount,
  rf.net_amount,
  rf.payment_method,
  rf.project_name,
  rf.handler,
  rf.is_beverage,
  rf.is_manual_override,
  rf.mapping_status,
  rf.quality_flags,
  rf.created_at
FROM raw_revenue_facts rf
LEFT JOIN business_dimensions layer_dim
  ON layer_dim.dimension_type = 'business_layer'
 AND layer_dim.code = rf.business_layer_code
LEFT JOIN business_dimensions type_dim
  ON type_dim.dimension_type = 'business_type'
 AND type_dim.code = rf.business_type_code;

CREATE OR REPLACE VIEW business_cost_facts_v2 AS
WITH expense_facts AS (
  SELECT
    ('expense:' || e.id) AS fact_id,
    'expense'::TEXT AS source_table,
    e.id AS source_id,
    'expense'::TEXT AS source_line_key,
    e.date AS business_date,
    'period_expense'::TEXT AS cost_basis,
    COALESCE(NULLIF(link.business_layer_code, ''), NULLIF(rule.business_layer_code, ''), '') AS business_layer_code,
    COALESCE(NULLIF(link.business_type_code, ''), NULLIF(rule.business_type_code, ''), '') AS business_type_code,
    COALESCE(NULLIF(link.cost_type_code, ''), NULLIF(rule.cost_type_code, ''), 'uncategorized_cost') AS cost_type_code,
    COALESCE(NULLIF(link.capability_axis_code, ''), NULLIF(rule.capability_axis_code, ''), '') AS capability_axis_code,
    ''::TEXT AS product_id,
    COALESCE(NULLIF(e.project, ''), NULLIF(e.category, ''), '支出') AS product_name_standard,
    0::NUMERIC AS quantity,
    0::NUMERIC AS unit_cost,
    COALESCE(e.amount, 0)::NUMERIC AS cost_amount,
    e.project AS project_name,
    e.handler,
    (link.id IS NOT NULL) AS is_manual_override,
    CASE WHEN link.id IS NOT NULL THEN 'manual_link' WHEN rule.id IS NOT NULL THEN 'rule_match' ELSE 'unmatched_default' END AS mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_business_layer', CASE WHEN COALESCE(NULLIF(link.business_layer_code, ''), NULLIF(rule.business_layer_code, ''), '') = '' THEN true ELSE NULL END,
      'missing_business_type', CASE WHEN COALESCE(NULLIF(link.business_type_code, ''), NULLIF(rule.business_type_code, ''), '') = '' THEN true ELSE NULL END
    )) AS quality_flags,
    e.created_at
  FROM expense e
  LEFT JOIN record_business_links link
    ON link.source_table = 'expense'
   AND link.source_id = e.id
   AND link.source_line_key = 'expense'
  LEFT JOIN LATERAL (
    SELECT br.*
    FROM business_mapping_rules br
    WHERE br.source_table = 'expense'
      AND br.is_active = true
      AND (
        (br.source_field = 'category' AND br.match_type = 'exact' AND br.match_value = e.category)
        OR (br.source_field = 'category' AND br.match_type = 'contains' AND e.category ILIKE ('%' || br.match_value || '%'))
        OR (br.source_field = 'description' AND br.match_type = 'contains' AND e.description ILIKE ('%' || br.match_value || '%'))
      )
    ORDER BY br.priority DESC, br.confidence DESC
    LIMIT 1
  ) rule ON true
),
retail_cogs AS (
  SELECT
    ('cogs:' || r.fact_id) AS fact_id,
    r.source_table,
    r.source_id,
    r.source_line_key,
    r.business_date,
    'sold_cogs'::TEXT AS cost_basis,
    r.business_layer_code,
    r.business_type_code,
    'product_purchase'::TEXT AS cost_type_code,
    ''::TEXT AS capability_axis_code,
    r.product_id,
    r.product_name_standard,
    r.quantity,
    r.unit_cost,
    COALESCE(r.quantity, 0) * COALESCE(r.unit_cost, 0) AS cost_amount,
    r.project_name,
    r.handler,
    r.is_manual_override,
    r.mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_unit_cost', CASE WHEN COALESCE(r.unit_cost, 0) = 0 THEN true ELSE NULL END
    )) AS quality_flags,
    r.created_at
  FROM business_revenue_facts_v2 r
  WHERE r.source_table = 'revenue'
    AND r.business_type_code IN ('creative_retail', 'beverage_retail')
    AND COALESCE(r.quantity, 0) <> 0
),
gallery_settlement AS (
  SELECT
    ('gallery_settlement:' || g.id) AS fact_id,
    'gallery_sales'::TEXT AS source_table,
    g.id AS source_id,
    'gallery_sale'::TEXT AS source_line_key,
    g.date AS business_date,
    'gallery_settlement'::TEXT AS cost_basis,
    'art_transaction_cooperation'::TEXT AS business_layer_code,
    COALESCE(NULLIF(g.business_type_code, ''), 'gallery_sale') AS business_type_code,
    'gallery_transaction'::TEXT AS cost_type_code,
    'business_cooperation'::TEXT AS capability_axis_code,
    COALESCE(NULLIF(g.artwork_id, ''), '') AS product_id,
    COALESCE(NULLIF(g.artwork_name, ''), NULLIF(a.title, ''), NULLIF(g.artwork_no, ''), '作品结算') AS product_name_standard,
    COALESCE(NULLIF(g.sale_quantity, 0), 1)::NUMERIC AS quantity,
    COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0)::NUMERIC AS unit_cost,
    COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0)::NUMERIC * COALESCE(NULLIF(g.sale_quantity, 0), 1)::NUMERIC AS cost_amount,
    COALESCE(NULLIF(g.related_exhibition, ''), '画廊') AS project_name,
    g.handler,
    false AS is_manual_override,
    'system_field'::TEXT AS mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_settlement_price', CASE WHEN COALESCE(NULLIF(g.settlement_price_snapshot, 0), a.settlement_price, 0) = 0 THEN true ELSE NULL END
    )) AS quality_flags,
    g.created_at
  FROM gallery_sales g
  LEFT JOIN artworks a
    ON a.id = g.artwork_id
    OR (NULLIF(g.artwork_id, '') IS NULL AND a.artwork_no = g.artwork_no)
  WHERE COALESCE(g.status, '') <> '已作废'
)
SELECT
  cf.fact_id,
  cf.source_table,
  cf.source_id,
  cf.source_line_key,
  cf.business_date,
  cf.cost_basis,
  cf.business_layer_code,
  COALESCE(layer_dim.name, cf.business_layer_code) AS business_layer_name,
  cf.business_type_code,
  COALESCE(type_dim.name, cf.business_type_code) AS business_type_name,
  cf.cost_type_code,
  COALESCE(cost_dim.name, cf.cost_type_code) AS cost_type_name,
  cf.capability_axis_code,
  COALESCE(cap_dim.name, cf.capability_axis_code) AS capability_axis_name,
  cf.product_id,
  cf.product_name_standard,
  cf.quantity,
  cf.unit_cost,
  cf.cost_amount,
  cf.project_name,
  cf.handler,
  cf.is_manual_override,
  cf.mapping_status,
  cf.quality_flags,
  cf.created_at
FROM (
  SELECT * FROM expense_facts
  UNION ALL
  SELECT * FROM retail_cogs
  UNION ALL
  SELECT * FROM gallery_settlement
) cf
LEFT JOIN business_dimensions layer_dim
  ON layer_dim.dimension_type = 'business_layer'
 AND layer_dim.code = cf.business_layer_code
LEFT JOIN business_dimensions type_dim
  ON type_dim.dimension_type = 'business_type'
 AND type_dim.code = cf.business_type_code
LEFT JOIN business_dimensions cost_dim
  ON cost_dim.dimension_type = 'cost_type'
 AND cost_dim.code = cf.cost_type_code
LEFT JOIN business_dimensions cap_dim
  ON cap_dim.dimension_type = 'capability_axis'
 AND cap_dim.code = cf.capability_axis_code;

CREATE OR REPLACE VIEW business_profit_facts_v2 AS
WITH matched_costs AS (
  SELECT
    source_table,
    source_id,
    source_line_key,
    SUM(cost_amount) AS matched_cost_amount
  FROM business_cost_facts_v2
  WHERE cost_basis IN ('sold_cogs', 'gallery_settlement')
  GROUP BY source_table, source_id, source_line_key
)
SELECT
  ('profit:' || r.fact_id) AS fact_id,
  r.fact_id AS revenue_fact_id,
  r.source_table,
  r.source_id,
  r.source_line_key,
  r.business_date,
  r.business_layer_code,
  r.business_layer_name,
  r.business_type_code,
  r.business_type_name,
  r.product_id,
  r.product_name_standard,
  r.quantity,
  r.gross_amount,
  r.net_amount AS revenue_amount,
  COALESCE(mc.matched_cost_amount, 0) AS cost_amount,
  r.net_amount - COALESCE(mc.matched_cost_amount, 0) AS gross_profit,
  CASE
    WHEN r.net_amount <> 0
      THEN (r.net_amount - COALESCE(mc.matched_cost_amount, 0)) / r.net_amount
    ELSE NULL
  END AS gross_margin,
  r.project_name,
  r.payment_method,
  r.mapping_status,
  r.quality_flags,
  r.created_at
FROM business_revenue_facts_v2 r
LEFT JOIN matched_costs mc
  ON mc.source_table = r.source_table
 AND mc.source_id = r.source_id
 AND mc.source_line_key = r.source_line_key;
