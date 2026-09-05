ALTER TABLE creative_products
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT '已上架',
  ADD COLUMN IF NOT EXISTS submitted_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT '已上架',
  ADD COLUMN IF NOT EXISTS submitted_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

UPDATE creative_products
   SET approval_status = '已上架'
 WHERE approval_status IS NULL OR approval_status = '';

UPDATE artworks
   SET approval_status = '已上架'
 WHERE approval_status IS NULL OR approval_status = '';
