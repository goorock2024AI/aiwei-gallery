-- POS收银模式新增字段
-- 收款方式
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT NULL;

-- 文创零售明细
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS retail_items JSONB DEFAULT '[]'::jsonb;

-- 套票（门票+咖啡）
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS combo_qty INTEGER DEFAULT 0;
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS combo_amount NUMERIC DEFAULT 0;
