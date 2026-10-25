-- M3-02: 2.0 business dimensions and mapping rules.
-- Scope: additive schema only. Do not delete or mutate 1.0 operational data.

BEGIN;

CREATE TABLE IF NOT EXISTS business_dimensions (
  id TEXT PRIMARY KEY,
  dimension_type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_code TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dimension_type, code),
  CHECK (dimension_type IN (
    'business_layer',
    'business_type',
    'cost_type',
    'capability_axis'
  ))
);

CREATE INDEX IF NOT EXISTS idx_business_dimensions_type_sort
  ON business_dimensions (dimension_type, sort_order, code);

CREATE INDEX IF NOT EXISTS idx_business_dimensions_parent
  ON business_dimensions (dimension_type, parent_code);

INSERT INTO business_dimensions
  (id, dimension_type, code, name, parent_code, sort_order, notes)
VALUES
  ('bd_layer_visit', 'business_layer', 'visit', '到馆参观', '', 10, '门票、参观套票等能够确认到馆的收入层。'),
  ('bd_layer_onsite_consumption', 'business_layer', 'onsite_consumption', '现场消费', '', 20, '文创零售、饮料、咖啡等现场消费收入层。'),
  ('bd_layer_experience_activity', 'business_layer', 'experience_activity', '体验活动', '', 30, '工坊、课程、研学等体验型收入层。'),
  ('bd_layer_art_transaction_cooperation', 'business_layer', 'art_transaction_cooperation', '艺术交易与合作', '', 40, '轻画廊、空间合作、品牌活动等交易与合作收入层。'),

  ('bd_type_ticket', 'business_type', 'ticket', '门票', 'visit', 110, '单独门票销售。'),
  ('bd_type_visit_combo', 'business_type', 'visit_combo', '到馆套票', 'visit', 120, '咖啡套票等能够确认到馆参观的套票。'),
  ('bd_type_creative_retail', 'business_type', 'creative_retail', '文创零售', 'onsite_consumption', 210, '不含饮料的文创商品销售。'),
  ('bd_type_beverage_retail', 'business_type', 'beverage_retail', '饮料零售', 'onsite_consumption', 220, '瓶装/听装饮料等低加工度饮品销售。'),
  ('bd_type_coffee', 'business_type', 'coffee', '咖啡', 'onsite_consumption', 230, '咖啡吧台单独销售，不等同于到馆参观。'),
  ('bd_type_workshop', 'business_type', 'workshop', '工坊', 'experience_activity', 310, '现场工坊和短时体验活动。'),
  ('bd_type_course_study', 'business_type', 'course_study', '课程/研学', 'experience_activity', 320, '课程、研学、长期活动。'),
  ('bd_type_gallery_sale', 'business_type', 'gallery_sale', '画廊销售', 'art_transaction_cooperation', 410, '作品销售、寄售、代理销售。'),
  ('bd_type_space_rental', 'business_type', 'space_rental', '空间租赁/合作', 'art_transaction_cooperation', 420, '空间租赁、场地合作、联合活动。'),
  ('bd_type_brand_event', 'business_type', 'brand_event', '品牌活动', 'art_transaction_cooperation', 430, '品牌合作、企业活动、赞助活动。'),
  ('bd_type_uncategorized_revenue', 'business_type', 'uncategorized_revenue', '未归类收入', '', 990, '迁移期兜底分类，后续需人工清理。'),

  ('bd_cost_product_purchase', 'cost_type', 'product_purchase', '商品采购成本', '', 110, '文创、饮料等商品采购成本。'),
  ('bd_cost_activity_execution', 'cost_type', 'activity_execution', '活动执行成本', '', 120, '工坊、课程、活动执行成本。'),
  ('bd_cost_exhibition_content', 'cost_type', 'exhibition_content', '展览与内容成本', '', 130, '展览制作、内容生产和布展成本。'),
  ('bd_cost_gallery_transaction', 'cost_type', 'gallery_transaction', '画廊交易成本', '', 140, '作品结算、佣金、运输、装裱等交易成本。'),
  ('bd_cost_space_operation', 'cost_type', 'space_operation', '空间运营成本', '', 150, '空间维护、物料、服务等成本。'),
  ('bd_cost_marketing', 'cost_type', 'marketing', '市场推广成本', '', 160, '投放、传播、物料等推广成本。'),
  ('bd_cost_labor', 'cost_type', 'labor', '人力成本', '', 170, '员工、兼职、外协人力。'),
  ('bd_cost_admin_finance', 'cost_type', 'admin_finance', '行政财务成本', '', 180, '办公、税费、行政财务相关支出。'),
  ('bd_cost_equipment_asset', 'cost_type', 'equipment_asset', '设备资产成本', '', 190, '设备、固定资产、长期用品。'),
  ('bd_cost_uncategorized_cost', 'cost_type', 'uncategorized_cost', '未归类成本', '', 990, '迁移期兜底分类，后续需人工清理。'),

  ('bd_cap_content_ip', 'capability_axis', 'content_ip', '内容/IP能力', '', 10, '展览内容、知识产品、衍生内容。'),
  ('bd_cap_audience_membership', 'capability_axis', 'audience_membership', '观众/会员能力', '', 20, '会员、复购、社群、观众资产。'),
  ('bd_cap_business_cooperation', 'capability_axis', 'business_cooperation', '商业合作能力', '', 30, '品牌合作、空间合作、画廊合作。')
ON CONFLICT (dimension_type, code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_code = EXCLUDED.parent_code,
  sort_order = EXCLUDED.sort_order,
  notes = EXCLUDED.notes,
  is_active = true,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS business_mapping_rules (
  id TEXT PRIMARY KEY,
  source_table TEXT NOT NULL,
  source_field TEXT NOT NULL,
  match_type TEXT NOT NULL,
  match_value TEXT NOT NULL,
  business_layer_code TEXT DEFAULT '',
  business_type_code TEXT DEFAULT '',
  cost_type_code TEXT DEFAULT '',
  capability_axis_code TEXT DEFAULT '',
  priority INTEGER DEFAULT 100,
  confidence NUMERIC(5, 2) DEFAULT 1.00,
  is_active BOOLEAN DEFAULT true,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_table, source_field, match_type, match_value, priority),
  CHECK (match_type IN ('exact', 'contains', 'prefix', 'suffix', 'regex', 'field'))
);

CREATE INDEX IF NOT EXISTS idx_business_mapping_rules_lookup
  ON business_mapping_rules (source_table, source_field, match_type, is_active, priority DESC);

CREATE INDEX IF NOT EXISTS idx_business_mapping_rules_business_type
  ON business_mapping_rules (business_type_code);

INSERT INTO business_mapping_rules
  (id, source_table, source_field, match_type, match_value, business_layer_code, business_type_code, cost_type_code, capability_axis_code, priority, confidence, notes)
VALUES
  ('rule_revenue_ticket_amount', 'revenue', 'ticket_amount', 'field', 'ticket_amount', 'visit', 'ticket', '', '', 900, 1.00, '1.0 门票金额字段映射。'),
  ('rule_revenue_combo_amount', 'revenue', 'combo_amount', 'field', 'combo_amount', 'visit', 'visit_combo', '', '', 900, 1.00, '咖啡套票等套票映射为到馆套票。'),
  ('rule_revenue_coffee_amount', 'revenue', 'coffee_amount', 'field', 'coffee_amount', 'onsite_consumption', 'coffee', '', '', 900, 1.00, '咖啡单独销售映射为现场消费，不等同到馆参观。'),
  ('rule_revenue_retail_items', 'revenue', 'retail_items', 'field', 'retail_items', 'onsite_consumption', 'creative_retail', '', '', 800, 0.80, '零售明细默认映射为文创零售，饮料由商品别名或人工规则覆盖。'),
  ('rule_revenue_workshop_amount', 'revenue', 'workshop_amount', 'field', 'workshop_amount', 'experience_activity', 'workshop', '', 'content_ip', 800, 0.80, '工坊收入字段映射。'),
  ('rule_gallery_sales_default', 'gallery_sales', 'status', 'field', 'status', 'art_transaction_cooperation', 'gallery_sale', '', 'business_cooperation', 800, 0.90, '画廊销售默认映射。'),
  ('rule_space_type_rental', 'space_usage', 'type', 'contains', '租', 'art_transaction_cooperation', 'space_rental', '', 'business_cooperation', 700, 0.80, '空间租赁类记录映射。'),
  ('rule_space_type_brand', 'space_usage', 'type', 'contains', '品牌', 'art_transaction_cooperation', 'brand_event', '', 'business_cooperation', 700, 0.80, '品牌活动类空间记录映射。'),
  ('rule_expense_product_purchase', 'expense', 'category', 'contains', '采购', 'onsite_consumption', '', 'product_purchase', '', 700, 0.80, '采购类支出映射为商品采购成本。'),
  ('rule_expense_beverage_purchase', 'expense', 'description', 'contains', '饮料', 'onsite_consumption', 'beverage_retail', 'product_purchase', '', 760, 0.85, '饮料进货支出映射。'),
  ('rule_expense_activity_execution', 'expense', 'category', 'contains', '活动', 'experience_activity', '', 'activity_execution', 'content_ip', 700, 0.75, '活动类支出映射。'),
  ('rule_expense_marketing', 'expense', 'category', 'contains', '推广', '', '', 'marketing', 'audience_membership', 650, 0.70, '推广类支出映射。')
ON CONFLICT (source_table, source_field, match_type, match_value, priority) DO UPDATE SET
  business_layer_code = EXCLUDED.business_layer_code,
  business_type_code = EXCLUDED.business_type_code,
  cost_type_code = EXCLUDED.cost_type_code,
  capability_axis_code = EXCLUDED.capability_axis_code,
  confidence = EXCLUDED.confidence,
  notes = EXCLUDED.notes,
  is_active = true,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS record_business_links (
  id TEXT PRIMARY KEY,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_line_key TEXT DEFAULT '',
  business_layer_code TEXT DEFAULT '',
  business_type_code TEXT DEFAULT '',
  cost_type_code TEXT DEFAULT '',
  capability_axis_code TEXT DEFAULT '',
  product_id TEXT DEFAULT '',
  product_alias_id TEXT DEFAULT '',
  mapping_rule_id TEXT DEFAULT '',
  override_reason TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_table, source_id, source_line_key)
);

CREATE INDEX IF NOT EXISTS idx_record_business_links_source
  ON record_business_links (source_table, source_id, source_line_key);

CREATE INDEX IF NOT EXISTS idx_record_business_links_business
  ON record_business_links (business_layer_code, business_type_code, cost_type_code);

ALTER TABLE business_dimensions DISABLE ROW LEVEL SECURITY;
ALTER TABLE business_mapping_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE record_business_links DISABLE ROW LEVEL SECURITY;

COMMIT;
