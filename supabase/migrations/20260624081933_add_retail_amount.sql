-- 新增文创零售金额合计列
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS retail_amount NUMERIC DEFAULT 0;
