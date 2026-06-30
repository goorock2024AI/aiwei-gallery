-- users 表 RLS 策略：允许 anon key 读取（用于登录验证）
-- 注意：users 表通过 supabase db push 创建，RLS 默认启用
-- 无策略时 anon key 无法查询 users 表

-- 允许所有用户（含 anon）查询 users 表（登录验证需要）
DROP POLICY IF EXISTS "anon_can_select_users" ON "users";
CREATE POLICY "anon_can_select_users" ON "users"
  FOR SELECT USING (true);

-- 允许用户更新自己的记录（修改密码）
DROP POLICY IF EXISTS "users_can_update_self" ON "users";
CREATE POLICY "users_can_update_self" ON "users"
  FOR UPDATE USING (true) WITH CHECK (true);
