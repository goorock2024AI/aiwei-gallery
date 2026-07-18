-- 空间使用重构迁移脚本（2026-07-10）
-- 本脚本：
--   1) space_usage 加 expected_payment_date 字段
--   2) 建 space_payments 子表 + 索引
--   3) 建 space_usage_with_payments 视图
--   4) 数据迁移：把 space_usage.received_amount > 0 的记录回填到子表
--   5) 校验：原 received_amount 是否等于 SUM 子表 amount

BEGIN;

-- 1) 加字段
ALTER TABLE space_usage ADD COLUMN IF NOT EXISTS expected_payment_date TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_space_usage_expected ON space_usage(expected_payment_date);

-- 2) 子表（幂等）
CREATE TABLE IF NOT EXISTS space_payments (
  id              TEXT PRIMARY KEY,
  space_usage_id  TEXT NOT NULL REFERENCES space_usage(id) ON DELETE CASCADE,
  payment_date    TEXT NOT NULL,
  amount          NUMERIC(12,2) DEFAULT 0,
  payment_method  TEXT DEFAULT '转账',
  notes           TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_space_payments_usage ON space_payments(space_usage_id);
CREATE INDEX IF NOT EXISTS idx_space_payments_date  ON space_payments(payment_date);
ALTER TABLE space_payments DISABLE ROW LEVEL SECURITY;

-- 3) 视图
CREATE OR REPLACE VIEW space_usage_with_payments AS
SELECT
  s.id, s.date, s.end_date, s.space, s.project_name, s.type, s.client,
  s.status, s.rental_type, s.receivable_amount, s.expected_payment_date,
  s.notes, s.created_at,
  COALESCE(
    (SELECT json_agg(json_build_object(
       'id', p.id,
       'paymentDate', p.payment_date,
       'amount', p.amount,
       'paymentMethod', p.payment_method,
       'notes', p.notes,
       'createdAt', p.created_at
     ) ORDER BY p.payment_date)
     FROM space_payments p WHERE p.space_usage_id = s.id),
    '[]'::json
  ) AS payments,
  COALESCE(
    (SELECT SUM(amount) FROM space_payments p WHERE p.space_usage_id = s.id),
    0
  ) AS received_amount
FROM space_usage s;

-- 4) 数据迁移：把已有 received_amount > 0 的记录回填到子表（仅当子表无该记录）
INSERT INTO space_payments (id, space_usage_id, payment_date, amount, payment_method, notes)
SELECT
  'pmt_' || s.id,
  s.id,
  COALESCE(NULLIF(s.end_date, ''), s.date),
  s.received_amount,
  '原系统迁移',
  '从 received_amount 字段回填（2026-07-10 重构）'
FROM space_usage s
WHERE s.received_amount > 0
  AND NOT EXISTS (SELECT 1 FROM space_payments p WHERE p.space_usage_id = s.id);

COMMIT;

-- 5) 校验：列出迁移结果对比（人工核对，应全为 0）
-- SELECT s.id, s.received_amount AS 旧字段,
--        COALESCE(SUM(p.amount), 0) AS 子表合计,
--        s.received_amount - COALESCE(SUM(p.amount), 0) AS 差异
-- FROM space_usage s
-- LEFT JOIN space_payments p ON p.space_usage_id = s.id
-- GROUP BY s.id, s.received_amount
-- HAVING s.received_amount > 0;