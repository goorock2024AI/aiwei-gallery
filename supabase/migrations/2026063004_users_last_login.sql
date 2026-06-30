-- users 表增加 last_login_at 字段（用于显示最后登录时间）

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
