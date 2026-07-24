#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${AIWEI_APP_DIR:-/opt/aiwei}"
SCRIPT_PATH="$APP_DIR/scripts/backup-db.sh"
SCHEDULE="${AIWEI_BACKUP_CRON_SCHEDULE:-17 3 * * *}"
CRON_MARKER="AIWEI_DB_BACKUP"
CRON_LINE="$SCHEDULE flock -xn /tmp/aiwei-db-backup-cron.lock -c '$SCRIPT_PATH >> $APP_DIR/backups/logs/cron.log 2>&1' # $CRON_MARKER"

if [ ! -f "$SCRIPT_PATH" ]; then
  echo "backup script not found: $SCRIPT_PATH" >&2
  exit 1
fi

chmod +x "$SCRIPT_PATH"
mkdir -p "$APP_DIR/backups/logs"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

crontab -l 2>/dev/null | grep -v "$CRON_MARKER" > "$tmp" || true
echo "$CRON_LINE" >> "$tmp"
crontab "$tmp"

echo "installed cron: $CRON_LINE"
