#!/bin/bash
set -euo pipefail

# Aiwei operation data system deployment script.
# Runs locally, packages the app, uploads it to the Tencent Cloud server,
# and starts PostgreSQL + Node.js API + Nginx through Docker Compose.

SERVER_IP="${SERVER_IP:-122.51.56.50}"
SERVER_USER="${SERVER_USER:-root}"
APP_DIR="${APP_DIR:-/opt/aiwei}"
PACKAGE="${PACKAGE:-aiwei-deploy.tar.gz}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DEPLOY_DIR"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${DB_PASSWORD:-}" ]; then
  error "DB_PASSWORD is not set. Create .env from .env.example or export DB_PASSWORD before deploy."
  exit 1
fi

echo "=============================================="
echo " Aiwei operation data system deployment"
echo " Server: $SERVER_IP"
echo "=============================================="

info "1/6 Packaging deployment files..."
for f in Dockerfile docker-compose.yml nginx.conf server.js package.json app/index.html; do
  if [ ! -f "$f" ]; then
    error "Missing required file: $f"
    exit 1
  fi
done

if grep -q "122.51.56.50" app/js/supabase-config.js; then
  info "  supabase-config.js API URL is correct"
else
  info "  Updating supabase-config.js API URL..."
  sed -i "s|url:.*|url: 'http://$SERVER_IP',|" app/js/supabase-config.js
fi

node scripts/build-version.js

rm -rf deploy-pkg
mkdir -p deploy-pkg
cp Dockerfile docker-compose.yml nginx.conf server.js package.json deploy-pkg/
cp -r app deploy-pkg/app
cp -r scripts deploy-pkg/scripts
rm -f deploy-pkg/app/lib/supabase.umd.min.js
printf "DB_PASSWORD=%s\n" "$DB_PASSWORD" > deploy-pkg/.env

tar czf "$PACKAGE" -C deploy-pkg .
rm -rf deploy-pkg
info "  Package ready: $PACKAGE"

info "2/6 Uploading package to server..."
scp -o StrictHostKeyChecking=accept-new "$PACKAGE" "$SERVER_USER@$SERVER_IP:/tmp/"

info "3/6 Installing and starting services on server..."
ssh -o StrictHostKeyChecking=accept-new "$SERVER_USER@$SERVER_IP" << 'REMOTEEOF'
set -euo pipefail

APP_DIR="/opt/aiwei"

info() { echo "[INFO] $1"; }
warn() { echo "[WARN] $1"; }

info "Creating app directory..."
mkdir -p "$APP_DIR"

info "Extracting deployment package..."
tar xzf /tmp/aiwei-deploy.tar.gz -C "$APP_DIR"
rm -f /tmp/aiwei-deploy.tar.gz

if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! docker compose version >/dev/null 2>&1; then
  info "Installing Docker Compose plugin..."
  DOCKER_CONFIG=/usr/local/lib/docker/cli-plugins
  mkdir -p "$DOCKER_CONFIG"
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o "$DOCKER_CONFIG/docker-compose"
  chmod +x "$DOCKER_CONFIG/docker-compose"
fi

cd "$APP_DIR"
set -a
. "$APP_DIR/.env"
set +a

info "Building and starting Docker services..."
docker compose build
docker compose up -d

info "Checking PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    info "PostgreSQL is ready"
    break
  fi
  sleep 2
done

info "Checking API..."
sleep 3
for i in $(seq 1 15); do
  if docker compose exec -T api wget -qO- http://localhost:3000/rest/v1/revenue?limit=1 >/dev/null 2>&1; then
    info "API is ready"
    break
  fi
  sleep 2
done

info "Checking Nginx..."
sleep 2
if curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ | grep -q "200\|301\|302"; then
  info "Nginx is ready"
else
  warn "Nginx status is abnormal; check docker compose logs nginx"
fi
REMOTEEOF

info "4/6 Configuring firewall..."
ssh "$SERVER_USER@$SERVER_IP" << 'FWEOF'
if command -v ufw >/dev/null 2>&1; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  ufw allow 80/tcp comment 'HTTP'
  ufw --force enable
  echo "[INFO] Firewall configured"
else
  echo "[WARN] ufw is not installed; skipped firewall configuration"
fi
FWEOF

info "5/6 Cleaning local temporary files..."
rm -f "$PACKAGE"

info "6/6 Deployment completed"
echo ""
echo "Visit: http://$SERVER_IP"
echo "API:   http://$SERVER_IP/rest/v1/"
echo "Admin user: admin"
echo "Admin password: obtain from private credentials and change after first login."
echo "Backup command: bash scripts/backup-db.sh"
