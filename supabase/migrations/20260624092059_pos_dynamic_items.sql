-- 为 POS 动态票务/咖啡新增列（JSONB 存储，每个元素 {name, qty, amount}）
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS ticket_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE revenue ADD COLUMN IF NOT EXISTS coffee_items JSONB DEFAULT '[]'::jsonb;
