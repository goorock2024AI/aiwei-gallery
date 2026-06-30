-- users 表 RLS 策略：允许 anon key 插入（管理员创建用户需要）

DROP POLICY IF EXISTS "anon_can_insert_users" ON "users";
CREATE POLICY "anon_can_insert_users" ON "users"
  FOR INSERT WITH CHECK (true);
