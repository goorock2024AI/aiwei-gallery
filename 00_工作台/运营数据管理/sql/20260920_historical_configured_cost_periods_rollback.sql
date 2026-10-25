BEGIN;

CREATE OR REPLACE VIEW configured_sale_cost_facts_v2 AS
WITH ticket_lines AS (
  SELECT r.id revenue_id,item.ord,r.date business_date,item.value,
    CASE WHEN COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','')='套票' THEN 'combo' ELSE 'ticket' END source_line_key,
    CASE WHEN COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','')='套票' THEN 'visit_combo' ELSE 'ticket' END business_type_code,
    'visit'::TEXT business_layer_code,COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','门票') product_name,
    r.project_name,r.handler,r.created_at
  FROM revenue r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.ticket_items)='array' THEN r.ticket_items ELSE '[]'::JSONB END) WITH ORDINALITY item(value,ord)
  WHERE COALESCE(r.status,'')<>'已作废'
), coffee_lines AS (
  SELECT r.id,item.ord,r.date,item.value,'coffee','coffee','onsite_consumption',
    COALESCE(item.value->>'name',item.value->>'productName',item.value->>'product_name','咖啡'),r.project_name,r.handler,r.created_at
  FROM revenue r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.coffee_items)='array' THEN r.coffee_items ELSE '[]'::JSONB END) WITH ORDINALITY item(value,ord)
  WHERE COALESCE(r.status,'')<>'已作废'
), workshop_lines AS (
  SELECT r.id,item.ord,r.date,item.value,('workshop:'||item.ord::TEXT),
    CASE WHEN COALESCE(item.value->>'activityTypeCode',item.value->>'activity_type_code')='course_study' THEN 'course_study' ELSE 'workshop' END,
    'experience_activity',COALESCE(item.value->>'productName',item.value->>'product_name',item.value->>'name','工坊/体验'),
    COALESCE(NULLIF(item.value->>'projectName',''),NULLIF(item.value->>'project_name',''),r.project_name),r.handler,r.created_at
  FROM revenue r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.workshop_items)='array' THEN r.workshop_items ELSE '[]'::JSONB END) WITH ORDINALITY item(value,ord)
  WHERE COALESCE(r.status,'')<>'已作废'
), configured_lines AS (
  SELECT * FROM ticket_lines UNION ALL SELECT * FROM coffee_lines UNION ALL SELECT * FROM workshop_lines
), snapshots AS (
  SELECT l.*,
    CASE WHEN COALESCE(l.value->>'qty',l.value->>'quantity',l.value->>'participantCount',l.value->>'participant_count','') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN COALESCE(l.value->>'qty',l.value->>'quantity',l.value->>'participantCount',l.value->>'participant_count')::NUMERIC ELSE 0::NUMERIC END quantity,
    COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot')::NUMERIC unit_cost
  FROM configured_lines l
  WHERE COALESCE(l.value->>'snapshotVersion',l.value->>'snapshot_version')='1'
    AND COALESCE(l.value->>'costPriceSnapshot',l.value->>'cost_price_snapshot','') ~ '^[0-9]+(\.[0-9]+)?$'
)
SELECT ('configured_cogs:revenue:'||s.revenue_id||':'||s.source_line_key||':'||s.ord::TEXT) fact_id,
  'revenue'::TEXT source_table,s.revenue_id source_id,s.source_line_key,s.business_date,'sold_cogs'::TEXT cost_basis,
  s.business_layer_code,COALESCE(layer_dim.name,s.business_layer_code) business_layer_name,s.business_type_code,
  COALESCE(type_dim.name,s.business_type_code) business_type_name,'product_purchase'::TEXT cost_type_code,
  COALESCE(cost_dim.name,'商品采购/销售成本') cost_type_name,''::TEXT capability_axis_code,''::TEXT capability_axis_name,
  ''::TEXT product_id,s.product_name product_name_standard,s.quantity,s.unit_cost,s.quantity*s.unit_cost cost_amount,
  s.project_name,s.handler,false is_manual_override,'sale_snapshot'::TEXT mapping_status,
  jsonb_strip_nulls(jsonb_build_object('missing_unit_cost',CASE WHEN s.unit_cost=0 THEN true ELSE NULL END)) quality_flags,s.created_at
FROM snapshots s
LEFT JOIN business_dimensions layer_dim ON layer_dim.dimension_type='business_layer' AND layer_dim.code=s.business_layer_code
LEFT JOIN business_dimensions type_dim ON type_dim.dimension_type='business_type' AND type_dim.code=s.business_type_code
LEFT JOIN business_dimensions cost_dim ON cost_dim.dimension_type='cost_type' AND cost_dim.code='product_purchase'
WHERE s.quantity<>0;

COMMIT;
