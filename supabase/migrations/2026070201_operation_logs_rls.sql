-- operation_logs 表 RLS 策略
-- 允许 anon key 插入操作日志（自动记录）
-- 允许 anon key 查询操作日志（日志查看页使用）

DROP POLICY IF EXISTS "anon_can_insert_operation_logs" ON "operation_logs";
CREATE POLICY "anon_can_insert_operation_logs" ON "operation_logs"
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "anon_can_select_operation_logs" ON "operation_logs";
CREATE POLICY "anon_can_select_operation_logs" ON "operation_logs"
  FOR SELECT USING (true);
