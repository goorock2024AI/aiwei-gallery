-- 允许匿名读写 app_config 表
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON app_config;
CREATE POLICY "anon_all" ON app_config FOR ALL
  USING (true)
  WITH CHECK (true);
