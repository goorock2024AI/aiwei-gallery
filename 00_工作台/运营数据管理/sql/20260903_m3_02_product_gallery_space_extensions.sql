-- M3-02: product aliases and additive extensions for product/gallery/space records.
-- Scope: only ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS product_aliases (
  id TEXT PRIMARY KEY,
  alias_name TEXT NOT NULL,
  standard_product_id TEXT DEFAULT '',
  standard_name TEXT NOT NULL,
  business_type_code TEXT DEFAULT '',
  package_spec TEXT DEFAULT '',
  unit_price NUMERIC(10, 2),
  cost_price_snapshot NUMERIC(10, 2),
  is_beverage BOOLEAN DEFAULT false,
  confidence NUMERIC(5, 2) DEFAULT 1.00,
  is_active BOOLEAN DEFAULT true,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_alias_lower
  ON product_aliases (lower(alias_name));

CREATE INDEX IF NOT EXISTS idx_product_aliases_standard_product
  ON product_aliases (standard_product_id);

CREATE INDEX IF NOT EXISTS idx_product_aliases_business_type
  ON product_aliases (business_type_code);

CREATE INDEX IF NOT EXISTS idx_product_aliases_beverage
  ON product_aliases (is_beverage, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_aliases_active_price
  ON product_aliases (
    lower(alias_name),
    COALESCE(unit_price, -1),
    COALESCE(package_spec, '')
  )
  WHERE is_active = true;

ALTER TABLE creative_products
  ADD COLUMN IF NOT EXISTS standard_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_type_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS package_spec TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS barcode TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_beverage BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_countable_stock BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_creative_products_standard_name_lower
  ON creative_products (lower(standard_name));

CREATE INDEX IF NOT EXISTS idx_creative_products_business_type
  ON creative_products (business_type_code);

CREATE INDEX IF NOT EXISTS idx_creative_products_beverage
  ON creative_products (is_beverage, is_active);

ALTER TABLE gallery_sales
  ADD COLUMN IF NOT EXISTS artwork_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_price_snapshot NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retail_price_snapshot NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_amount_snapshot NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_snapshot NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gallery_channel TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_type_code TEXT DEFAULT 'gallery_sale';

CREATE INDEX IF NOT EXISTS idx_gallery_sales_artwork_id
  ON gallery_sales (artwork_id);

CREATE INDEX IF NOT EXISTS idx_gallery_sales_business_type
  ON gallery_sales (business_type_code);

CREATE INDEX IF NOT EXISTS idx_gallery_sales_gallery_channel
  ON gallery_sales (gallery_channel);

ALTER TABLE space_usage
  ADD COLUMN IF NOT EXISTS business_layer_code TEXT DEFAULT 'art_transaction_cooperation',
  ADD COLUMN IF NOT EXISTS business_type_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cooperation_mode TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS project_owner TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_no TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_status TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_space_usage_business_type
  ON space_usage (business_type_code);

CREATE INDEX IF NOT EXISTS idx_space_usage_business_status
  ON space_usage (business_status);

CREATE INDEX IF NOT EXISTS idx_space_usage_contract_no
  ON space_usage (contract_no);

ALTER TABLE product_aliases DISABLE ROW LEVEL SECURITY;

COMMIT;
