-- 插入管理员初始账号
-- 密码：admin888888 → SHA-256: a9e6838e46e6a2ade1b48f768550ddb70f4bc76babaf6fa7e83818074fe394b5
-- 首次登录强制修改密码
-- 注意：此迁移在 2026063002（RLS 策略）之后执行，确保 anon key 可查询

INSERT INTO "users" (id, username, display_name, role, password_hash, is_active, created_at)
SELECT
  'usr_admin_001',
  'admin',
  '管理员',
  'admin',
  '__need_change__:a9e6838e46e6a2ade1b48f768550ddb70f4bc76babaf6fa7e83818074fe394b5',
  TRUE,
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE username = 'admin');
