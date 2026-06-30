-- users 表 RLS 策略修正：增加 UPDATE 权限（改密操作）
-- 替换之前的策略，多余策略一并清理

DROP POLICY IF EXISTS "service_role_can_insert_users" ON "users";
DROP POLICY IF EXISTS "anon_can_update_users" ON "users";

CREATE POLICY "anon_can_update_users" ON "users"
  FOR UPDATE USING (true) WITH CHECK (true);
