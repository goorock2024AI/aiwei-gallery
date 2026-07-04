#!/bin/bash
# ===============================================================
# 艾维美术馆运营数据管理系统 · 腾讯云全 Docker 部署脚本
# 目标：腾讯云轻量应用服务器 Ubuntu 22.04
# 功能：Docker Compose 一键启动 PostgreSQL + Node.js API + Nginx
# ===============================================================
set -e

# ===== 配置参数 =====
SERVER_IP="122.51.56.50"
SERVER_USER="root"
DB_PASSWORD="Aiwei2024Gallery!"
APP_DIR="/opt/aiwei"
PACKAGE="aiwei-deploy.tar.gz"

# 颜色输出
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "=============================================="
echo " 艾维美术馆 · 腾讯云全 Docker 部署"
echo " 服务器: $SERVER_IP"
echo "=============================================="

# ============================================================
# 第一步：本地打包部署文件
# ============================================================
info "1/6 打包部署文件..."
DEPLOY_DIR=$(dirname "$0")
cd "$DEPLOY_DIR"

# 验证关键文件存在
for f in Dockerfile docker-compose.yml nginx.conf server.js package.json app/index.html; do
  if [ ! -f "$f" ]; then
    error "缺少必需文件: $f"
    exit 1
  fi
done

# 确保 supabase-config.js 指向正确的服务器 IP
if grep -q "122.51.56.50" app/js/supabase-config.js; then
  info "  supabase-config.js API 地址正确 ✅"
else
  info "  更新 supabase-config.js API 地址为服务器 IP..."
  sed -i "s|url:.*|url: 'http://$SERVER_IP',|" app/js/supabase-config.js
fi

# 创建打包目录
rm -rf deploy-pkg
mkdir -p deploy-pkg

# 复制必需文件
cp Dockerfile docker-compose.yml nginx.conf server.js package.json deploy-pkg/
cp -r app deploy-pkg/app
# 删除不需要的文件（lib 中的 supabase SDK 可保留但不会被使用，sql 目录由 init.sql 挂载）
rm -f deploy-pkg/app/lib/supabase.umd.min.js

# 创建 .env 文件（不包含敏感信息提交到版本控制）
echo "DB_PASSWORD=$DB_PASSWORD" > deploy-pkg/.env

# 打包
tar czf "$PACKAGE" -C deploy-pkg .
rm -rf deploy-pkg

info "  打包完成: $PACKAGE"

# ============================================================
# 第二步：上传到服务器
# ============================================================
info "2/6 上传部署包到服务器..."
scp -o StrictHostKeyChecking=accept-new "$PACKAGE" "$SERVER_USER@$SERVER_IP:/tmp/"

# ============================================================
# 第三步：SSH 远程安装 Docker + 部署
# ============================================================
info "3/6 SSH 连接服务器并执行部署..."
ssh -o StrictHostKeyChecking=accept-new "$SERVER_USER@$SERVER_IP" << 'REMOTEEOF'
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }

APP_DIR="/opt/aiwei"

# 创建应用目录
info "  创建应用目录..."
mkdir -p "$APP_DIR"

# 解压部署包
info "  解压部署包..."
tar xzf /tmp/aiwei-deploy.tar.gz -C "$APP_DIR"
rm -f /tmp/aiwei-deploy.tar.gz

# 安装 Docker（如未安装）
if ! command -v docker &>/dev/null; then
  info "  安装 Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
fi

# 安装 Docker Compose 插件（如未安装）
if ! docker compose version &>/dev/null; then
  info "  安装 Docker Compose 插件..."
  DOCKER_CONFIG=/usr/local/lib/docker/cli-plugins
  mkdir -p "$DOCKER_CONFIG"
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o "$DOCKER_CONFIG/docker-compose"
  chmod +x "$DOCKER_CONFIG/docker-compose"
fi

info "  Docker: $(docker --version)"
info "  Docker Compose: $(docker compose version)"

# 加载环境变量
set -a; source "$APP_DIR/.env"; set +a

# 登录到 Docker Hub（非必需，postgres/nginx 使用公共镜像）
# 构建并启动全部服务
info "  构建并启动 Docker 服务..."
cd "$APP_DIR"
docker compose build
docker compose up -d

# ============================================================
# 第四步：健康检查
# ============================================================
info "4/6 健康检查..."

# 等待数据库就绪
info "  等待 PostgreSQL 就绪..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres &>/dev/null; then
    info "  PostgreSQL 已就绪 ✅"
    break
  fi
  sleep 2
done

# 等待 API 就绪
info "  等待 API 服务就绪..."
sleep 3
for i in $(seq 1 15); do
  if docker compose exec -T api wget -qO- http://localhost:3000/rest/v1/revenue?limit=1 &>/dev/null; then
    info "  API 服务已就绪 ✅"
    break
  fi
  sleep 2
done

# 等待 Nginx 就绪
info "  等待 Nginx 就绪..."
sleep 2
if curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ | grep -q "200\|301\|302"; then
  info "  Nginx 已就绪 ✅"
else
  warn "  Nginx 状态异常，请检查日志"
fi

REMOTEEOF

# ============================================================
# 第五步：配置防火墙
# ============================================================
info "5/6 配置防火墙..."
ssh "$SERVER_USER@$SERVER_IP" << 'FWEOF'
  if command -v ufw &>/dev/null; then
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment 'SSH'
    ufw allow 80/tcp comment 'HTTP'
    ufw --force enable
    echo "  防火墙已配置 ✅"
  else
    echo "  ufw 未安装，跳过防火墙配置"
  fi
FWEOF

# ============================================================
# 第六步：清理本地临时文件
# ============================================================
info "6/6 清理本地临时文件..."
rm -f "$PACKAGE"

# ============================================================
# 完成！
# ============================================================
echo ""
echo "=============================================="
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "=============================================="
echo ""
echo "  访问地址: http://$SERVER_IP"
echo "  API 地址: http://$SERVER_IP/rest/v1/"
echo ""
echo "  管理员账号:"
echo "    用户名: admin"
echo "    密码:   admin888（首次登录会提示修改密码）"
echo ""
echo "  后续管理命令（服务器上执行）:"
echo "    docker compose ps              # 查看服务状态"
echo "    docker compose logs -f         # 查看日志"
echo "    docker compose restart         # 重启服务"
echo "    docker compose down            # 停止服务"
echo "    docker compose pull            # 更新镜像"
echo ""
echo "  更新前端: 本地修改 app/ 后重新运行本脚本即可"
echo "  备份数据库: docker compose exec db pg_dump -U postgres > backup.sql"
echo ""
echo "=============================================="
