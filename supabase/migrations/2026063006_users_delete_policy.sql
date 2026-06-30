-- users 表 DELETE RLS 策略：允许 anon key 删除（管理员删除用户需要）

DROP POLICY IF EXISTS "anon_can_delete_users" ON "users";
CREATE POLICY "anon_can_delete_users" ON "users"
  FOR DELETE USING (true);
