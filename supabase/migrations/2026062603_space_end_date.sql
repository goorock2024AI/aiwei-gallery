-- 空间使用表：新增结束时间字段
ALTER TABLE space_usage ADD COLUMN IF NOT EXISTS end_date TEXT DEFAULT '';
