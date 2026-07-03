#!/bin/bash
# ===============================================================
# 艾维美术馆运营数据管理系统 · 一键部署脚本
# 目标：腾讯云轻量应用服务器 Ubuntu 22.04
# 功能：Docker + PostgreSQL + PostgREST + Nginx + 防火墙
# ===============================================================
set -e

# ===== 配置参数（可修改）=====
DB_PASSWORD="Aiwei2024Gallery!"
PGRST_JWT_SECRET="aiwei-gallery-jwt-secret-2024"
ANON_KEY="aiwei_anon_key_public_2024"
DOMAIN_OR_IP="122.51.56.50"
APP_DIR="/var/www/aiwei"

# 颜色输出
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "=============================================="
echo " 艾维美术馆 · 一键部署"
echo " 服务器: $DOMAIN_OR_IP"
echo "=============================================="

# ============================================================
# 第一步：系统更新 + 安装依赖
# ============================================================
info "1/8 更新系统并安装依赖..."
apt-get update -y
apt-get upgrade -y
apt-get install -y curl wget gnupg lsb-release ca-certificates nginx ufw

# ============================================================
# 第二步：安装 Docker
# ============================================================
info "2/8 安装 Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
fi

# 安装 Docker Compose 插件
if ! docker compose version &>/dev/null; then
  DOCKER_CONFIG=/usr/local/lib/docker/cli-plugins
  mkdir -p $DOCKER_CONFIG
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o $DOCKER_CONFIG/docker-compose
  chmod +x $DOCKER_CONFIG/docker-compose
fi

info "Docker 版本: $(docker --version)"
info "Docker Compose: $(docker compose version)"

# ============================================================
# 第三步：创建应用目录结构
# ============================================================
info "3/8 创建应用目录..."
mkdir -p /opt/aiwei/{db,nginx,data}
mkdir -p $APP_DIR
mkdir -p /opt/aiwei/postgrest

# ============================================================
# 第四步：配置 docker-compose（PostgreSQL + PostgREST）
# ============================================================
info "4/8 创建 docker-compose.yml..."

# 生成 PostgREST 配置文件
cat > /opt/aiwei/postgrest/aiwei.conf << 'PGRSTEOF'
db-uri = "postgres://postgres:AIWEI_DB_PASSWORD_PLACEHOLDER@db:5432/postgres"
db-schema = "public"
db-anon-role = "postgres"
# 不设置 jwt-secret → PostgREST 忽略所有 JWT，使用 anon 角色
# 兼容现有前端代码（所有请求都带 apikey header）
openapi-server-proxy-uri = "AIWEI_DOMAIN_PLACEHOLDER"
PGRSTEOF

# 替换占位符
sed -i "s/AIWEI_DB_PASSWORD_PLACEHOLDER/$DB_PASSWORD/g" /opt/aiwei/postgrest/aiwei.conf
sed -i "s|AIWEI_DOMAIN_PLACEHOLDER|http://$DOMAIN_OR_IP|g" /opt/aiwei/postgrest/aiwei.conf

cat > /opt/aiwei/docker-compose.yml << 'COMPOSEEOF'
services:
  # --- PostgreSQL 17 ---
  db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_PASSWORD: AIWEI_DB_PASSWORD_PLACEHOLDER
      POSTGRES_DB: postgres
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - aiwei-net

  # --- PostgREST（REST API）---
  rest:
    image: postgrest/postgrest:v12
    restart: always
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./postgrest/aiwei.conf:/etc/postgrest.conf:ro
    command: ["postgrest", "/etc/postgrest.conf"]
    networks:
      - aiwei-net

  # --- Nginx（反向代理 + 静态文件）---
  # 使用外部 Nginx 而非 Docker 内的 Nginx，方便管理
  # 见下方的 Nginx 配置

networks:
  aiwei-net:
    driver: bridge

volumes:
  db-data:
COMPOSEEOF

# 替换 docker-compose.yml 中的占位符
sed -i "s/AIWEI_DB_PASSWORD_PLACEHOLDER/$DB_PASSWORD/g" /opt/aiwei/docker-compose.yml

# ============================================================
# 第五步：创建数据库初始化脚本
# ============================================================
info "5/8 创建数据库初始化脚本..."

cat > /opt/aiwei/db/init.sql << 'SQLEOF'
-- 艾维美术馆运营数据管理 · 数据库初始化

-- 1. 收入表
CREATE TABLE IF NOT EXISTS revenue (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  ticket_qty INTEGER DEFAULT 0,
  ticket_amount NUMERIC(12,2) DEFAULT 0,
  combo_qty INTEGER DEFAULT 0,
  combo_amount NUMERIC(12,2) DEFAULT 0,
  coffee_qty INTEGER DEFAULT 0,
  coffee_amount NUMERIC(12,2) DEFAULT 0,
  ticket_items JSONB DEFAULT '[]',
  coffee_items JSONB DEFAULT '[]',
  workshop_items JSONB DEFAULT '[]',
  workshop_amount NUMERIC(12,2) DEFAULT 0,
  retail_items JSONB DEFAULT '[]',
  retail_amount NUMERIC(12,2) DEFAULT 0,
  creative_amount NUMERIC(12,2) DEFAULT 0,
  venue_amount NUMERIC(12,2) DEFAULT 0,
  other_amount NUMERIC(12,2) DEFAULT 0,
  other_desc TEXT DEFAULT '',
  cash_amount NUMERIC(12,2) DEFAULT 0,
  account_amount NUMERIC(12,2) DEFAULT 0,
  payment_method TEXT DEFAULT '扫码支付',
  project_name TEXT DEFAULT '',
  handler TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue(date);

-- 2. 支出表
CREATE TABLE IF NOT EXISTS expense (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT DEFAULT '备用金支出',
  project TEXT DEFAULT '运营',
  category TEXT DEFAULT '材料',
  amount NUMERIC(12,2) DEFAULT 0,
  description TEXT DEFAULT '',
  handler TEXT DEFAULT '',
  invoice_status TEXT DEFAULT '待补',
  receipt_status TEXT DEFAULT '待补',
  related_activity TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense(date);

-- 3. 空间使用表
CREATE TABLE IF NOT EXISTS space_usage (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  end_date TEXT DEFAULT '',
  space TEXT DEFAULT '1号厅',
  project_name TEXT DEFAULT '',
  type TEXT DEFAULT '展览',
  client TEXT DEFAULT '',
  status TEXT DEFAULT '筹备中',
  rental_type TEXT DEFAULT '付费',
  receivable_amount NUMERIC(12,2) DEFAULT 0,
  received_amount NUMERIC(12,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_space_usage_date ON space_usage(date);

-- 4. 画廊销售表
CREATE TABLE IF NOT EXISTS gallery_sales (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  artwork_name TEXT DEFAULT '',
  artist TEXT DEFAULT '',
  price NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  buyer_name TEXT DEFAULT '',
  payment_method TEXT DEFAULT '扫码支付',
  related_exhibition TEXT DEFAULT '',
  status TEXT DEFAULT '已售出',
  handler TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gallery_sales_date ON gallery_sales(date);

-- 5. 应用配置表
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 用户表（自定义认证）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'editor',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 7. 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT DEFAULT '',
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at);

-- 8. 全域数据实体表
CREATE TABLE IF NOT EXISTS project_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  tags JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  quantity INTEGER DEFAULT 0,
  unit TEXT DEFAULT '个',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  year TEXT DEFAULT '',
  medium TEXT DEFAULT '',
  dimensions TEXT DEFAULT '',
  location TEXT DEFAULT '',
  status TEXT DEFAULT '在库',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT DEFAULT '',
  publish_date TEXT DEFAULT '',
  status TEXT DEFAULT '草稿',
  url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 关闭 RLS（兼容现有前端代码）
ALTER TABLE revenue DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense DISABLE ROW LEVEL SECURITY;
ALTER TABLE space_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE operation_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE project_registry DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE artworks DISABLE ROW LEVEL SECURITY;
ALTER TABLE partners DISABLE ROW LEVEL SECURITY;
ALTER TABLE content_posts DISABLE ROW LEVEL SECURITY;

-- 种子配置数据
INSERT INTO app_config (key, value) VALUES
('ticket_products', '[{"name":"普通票","price":10},{"name":"套票","price":25}]'),
('coffee_products', '[{"name":"手冲咖啡","price":15}]'),
('workshop_products', '[{"name":"果壳风铃","price":128},{"name":"豆荚娃娃","price":118},{"name":"迷你冰箱贴","price":35},{"name":"木刻杯垫","price":88},{"name":"A5木刻","price":168},{"name":"A4木刻","price":198},{"name":"拓印体验","price":38}]'),
('spaces', '[{"name":"1号厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"2号厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"美学空间","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"多功能厅","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"六楼综合空间","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"走廊画廊","dailyPrice":0,"halfDayPrice":0,"desc":""},{"name":"户外露台","dailyPrice":0,"halfDayPrice":0,"desc":""}]')
ON CONFLICT (key) DO NOTHING;

-- 创建默认管理员（密码: admin888）
-- 密码哈希为 SHA-256('admin888') 的十六进制
INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES
('usr_admin_init', 'admin', '管理员', '__need_change__:9f6e6800cfae7749eb6c8036192359176c43e0f113492473ac8c9535bdb7e7f8', 'admin', true)
ON CONFLICT (username) DO NOTHING;
SQLEOF

# ============================================================
# 第六步：启动 Docker 服务
# ============================================================
info "6/8 启动 PostgreSQL + PostgREST..."
cd /opt/aiwei
docker compose up -d

# 等待数据库就绪
info "等待数据库就绪..."
sleep 10
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres &>/dev/null; then
    info "数据库已就绪！"
    break
  fi
  sleep 2
done

# ============================================================
# 第七步：配置 Nginx
# ============================================================
info "7/8 配置 Nginx..."

# 创建占位首页
cat > $APP_DIR/index.html << 'HTMLEOF'
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>艾维美术馆 · 运营数据管理</title>
<style>
body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
.card { text-align: center; padding: 48px; background: white; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
h1 { color: #1a5632; } .status { color: #666; margin: 16px 0; }
.loading { color: #999; } .ok { color: #1a5632; font-weight: bold; }
</style></head><body>
<div class="card">
<h1>🏛️ 艾维美术馆</h1>
<p class="status">运营数据管理系统</p>
<p class="ok">✅ 服务器部署成功！</p>
<p class="loading">请上传前端文件到 /var/www/aiwei/</p>
<p id="api-status">检查数据库连接中...</p>
</div>
<script>
fetch('/rest/v1/revenue?limit=1')
  .then(r => r.ok ? '✅ 数据库连接正常' : '⚠️ 数据库异常: ' + r.status)
  .then(msg => document.getElementById('api-status').textContent = msg)
  .catch(e => document.getElementById('api-status').textContent = '❌ 数据库连接失败: ' + e.message);
</script>
</body></html>
HTMLEOF

# 配制 Nginx 反向代理
cat > /etc/nginx/sites-available/aiwei << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;

    # 前端静态文件
    root /var/www/aiwei;
    index index.html;
    charset utf-8;

    # 静态文件直接服务
    location / {
        try_files $uri $uri/ /index.html;
    }

    # PostgREST API 反向代理
    location /rest/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（数据报表可能查询较久）
        proxy_connect_timeout 30;
        proxy_read_timeout 120;
        proxy_send_timeout 30;

        # 大 JSON 请求体支持
        client_max_body_size 10m;
    }

    # 安全头
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;

    # 日志
    access_log /var/log/nginx/aiwei_access.log;
    error_log  /var/log/nginx/aiwei_error.log;
}
NGINXEOF

# 启用站点
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/aiwei /etc/nginx/sites-enabled/aiwei
nginx -t && systemctl reload nginx

# ============================================================
# 第八步：配置防火墙
# ============================================================
info "8/8 配置防火墙..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw --force enable

# ============================================================
# 完成！
# ============================================================
echo ""
echo "=============================================="
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "=============================================="
echo ""
echo "访问地址: http://$DOMAIN_OR_IP"
echo ""
echo "PostgREST API: http://$DOMAIN_OR_IP/rest/v1/"
echo "数据库端口: 127.0.0.1:5432（仅内网）"
echo ""
echo "配置信息（用于修改前端 supabase-config.js）："
echo "  URL:      http://$DOMAIN_OR_IP"
echo "  anonKey:  $ANON_KEY"
echo "  说明:     anonKey 可以是任意值（本部署不验证 JWT）"
echo ""
echo "管理员账号："
echo "  用户名: admin"
echo "  密码:   admin888（首次登录会提示修改密码）"
echo ""
echo "前端文件位置: $APP_DIR"
echo "请将 app/ 目录下所有文件上传到 $APP_DIR"
echo ""
echo "上传方式（在本地电脑执行）："
echo "  scp -r /path/to/app/* root@$DOMAIN_OR_IP:$APP_DIR/"
echo ""
echo "后续管理命令："
echo "  查看服务状态:  cd /opt/aiwei && docker compose ps"
echo "  查看日志:      cd /opt/aiwei && docker compose logs -f"
echo "  重启服务:      cd /opt/aiwei && docker compose restart"
echo "  停止服务:      cd /opt/aiwei && docker compose down"
echo "=============================================="
