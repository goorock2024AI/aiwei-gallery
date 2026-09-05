-- M3-02 rollback script.
-- Use only after confirming there are no new 2.0 records that must be preserved.
-- This script does not delete 1.0 base rows or drop 1.0 original columns.

BEGIN;

-- Part A: disable 2.0 reporting views.
DROP VIEW IF EXISTS business_profit_facts_v2;
DROP VIEW IF EXISTS business_cost_facts_v2;
DROP VIEW IF EXISTS business_revenue_facts_v2;

-- Part B: remove additive 2.0 metadata structures.
DROP TABLE IF EXISTS record_business_links;
DROP TABLE IF EXISTS product_aliases;
DROP TABLE IF EXISTS business_mapping_rules;
DROP TABLE IF EXISTS business_dimensions;

-- Part C: remove additive columns introduced by M3-02.
-- If these columns already contain manually entered 2.0 metadata, export them before running rollback.
ALTER TABLE creative_products
  DROP COLUMN IF EXISTS standard_name,
  DROP COLUMN IF EXISTS business_type_code,
  DROP COLUMN IF EXISTS package_spec,
  DROP COLUMN IF EXISTS barcode,
  DROP COLUMN IF EXISTS is_beverage,
  DROP COLUMN IF EXISTS is_countable_stock,
  DROP COLUMN IF EXISTS is_active;

ALTER TABLE gallery_sales
  DROP COLUMN IF EXISTS artwork_id,
  DROP COLUMN IF EXISTS settlement_price_snapshot,
  DROP COLUMN IF EXISTS retail_price_snapshot,
  DROP COLUMN IF EXISTS gross_amount_snapshot,
  DROP COLUMN IF EXISTS net_amount_snapshot,
  DROP COLUMN IF EXISTS gallery_channel,
  DROP COLUMN IF EXISTS business_type_code;

ALTER TABLE space_usage
  DROP COLUMN IF EXISTS business_layer_code,
  DROP COLUMN IF EXISTS business_type_code,
  DROP COLUMN IF EXISTS cooperation_mode,
  DROP COLUMN IF EXISTS project_owner,
  DROP COLUMN IF EXISTS contract_no,
  DROP COLUMN IF EXISTS business_status;

COMMIT;
