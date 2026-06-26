-- 画廊销售记录表
CREATE TABLE IF NOT EXISTS gallery_sales (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  artwork_name TEXT NOT NULL,
  artist TEXT DEFAULT '',
  price NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  buyer_name TEXT DEFAULT '',
  payment_method TEXT DEFAULT '扫码支付',
  related_exhibition TEXT DEFAULT '',
  status TEXT DEFAULT '已售出',
  handler TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gallery_sales_date ON gallery_sales(date);

ALTER TABLE gallery_sales DISABLE ROW LEVEL SECURITY;
