#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${AIWEI_APP_DIR:-/opt/aiwei}"
BACKUP_DIR="${AIWEI_BACKUP_DIR:-$APP_DIR/backups/postgres}"
LOG_DIR="${AIWEI_BACKUP_LOG_DIR:-$APP_DIR/backups/logs}"
RETENTION_DAYS="${AIWEI_BACKUP_RETENTION_DAYS:-14}"
LOCK_FILE="${AIWEI_BACKUP_LOCK_FILE:-/tmp/aiwei-db-backup.lock}"
DATABASE="${AIWEI_BACKUP_DATABASE:-postgres}"
DB_USER="${AIWEI_BACKUP_DB_USER:-postgres}"
BASELINE_SQL="${AIWEI_BASELINE_SQL:-$APP_DIR/sql/m6-07-baseline.sql}"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] another backup is running; exit"
  exit 0
fi

cd "$APP_DIR"

if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_name="aiwei-postgres-$timestamp.dump"
backup_file="$BACKUP_DIR/$backup_name"
tmp_file="$backup_file.tmp"
manifest_file="$BACKUP_DIR/$backup_name.manifest"
manifest_tmp="$manifest_file.tmp"
baseline_file="$BACKUP_DIR/$backup_name.baseline.json"
baseline_tmp="$baseline_file.tmp"
log_file="$LOG_DIR/backup-$timestamp.log"

log() {
  echo "[$(date -Is)] $*" | tee -a "$log_file"
}

cleanup_tmp() {
  rm -f "$tmp_file" "$baseline_tmp" "$manifest_tmp"
}
trap cleanup_tmp EXIT

log "backup started"
log "app_dir=$APP_DIR backup_dir=$BACKUP_DIR retention_days=$RETENTION_DAYS"

docker compose exec -T db pg_isready -U "$DB_USER" -d "$DATABASE" >>"$log_file" 2>&1
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DATABASE" -Fc --no-owner --no-acl > "$tmp_file"

if [ ! -s "$tmp_file" ]; then
  log "backup failed: empty dump"
  exit 1
fi

if [ ! -f "$BASELINE_SQL" ]; then
  log "backup failed: baseline SQL not found: $BASELINE_SQL"
  exit 1
fi
docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DATABASE" -tA < "$BASELINE_SQL" > "$baseline_tmp"
if [ ! -s "$baseline_tmp" ] || ! grep -q '"schema"' "$baseline_tmp"; then
  log "backup failed: baseline output is empty or invalid"
  exit 1
fi

pg_restore_check_output="$(docker compose exec -T db sh -c "command -v pg_restore" 2>/dev/null || true)"
if [ -n "$pg_restore_check_output" ]; then
  docker compose exec -T db pg_restore --list < "$tmp_file" >/dev/null
  log "pg_restore list verification passed"
else
  log "backup failed: pg_restore not found in db container"
  exit 1
fi

mv "$tmp_file" "$backup_file"
mv "$baseline_tmp" "$baseline_file"
(cd "$BACKUP_DIR" && sha256sum "$backup_name" > "$backup_name.sha256")
(cd "$BACKUP_DIR" && sha256sum "$backup_name.baseline.json" > "$backup_name.baseline.json.sha256")

size_bytes="$(stat -c%s "$backup_file")"
table_count="$(docker compose exec -T db psql -U "$DB_USER" -d "$DATABASE" -tAc "select count(*) from pg_tables where schemaname='public';" | tr -d '[:space:]')"
db_size="$(docker compose exec -T db psql -U "$DB_USER" -d "$DATABASE" -tAc "select pg_database_size('$DATABASE');" | tr -d '[:space:]')"
backup_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
baseline_sha256="$(sha256sum "$baseline_file" | awk '{print $1}')"
app_version="$(cat "$APP_DIR/VERSION" 2>/dev/null || printf 'unknown')"

cat > "$manifest_tmp" <<EOF
created_at=$(date -Is)
database=$DATABASE
db_user=$DB_USER
backup_file=$backup_file
size_bytes=$size_bytes
table_count=$table_count
database_size_bytes=$db_size
backup_sha256=$backup_sha256
baseline_file=$baseline_file
baseline_sha256=$baseline_sha256
app_version=$app_version
retention_days=$RETENTION_DAYS
format=pg_dump_custom
verify_command=pg_restore --list "$backup_file" >/dev/null
EOF
mv "$manifest_tmp" "$manifest_file"

find "$BACKUP_DIR" -type f -name 'aiwei-postgres-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'aiwei-postgres-*.dump.sha256' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'aiwei-postgres-*.dump.manifest' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'aiwei-postgres-*.dump.baseline.json' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'aiwei-postgres-*.dump.baseline.json.sha256' -mtime +"$RETENTION_DAYS" -delete
find "$LOG_DIR" -type f -name 'backup-*.log' -mtime +"$RETENTION_DAYS" -delete

log "backup completed: $backup_file ($size_bytes bytes)"
