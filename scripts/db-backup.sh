#!/usr/bin/env bash
# Phase 5.4 — Postgres backup script.
#
# Dumps the Sentinel Postgres database to a timestamped .sql.gz file via
# `pg_dump` running inside the existing `sentinel-db` container. Designed
# for daily cron OR ad-hoc runs before risky migrations.
#
# Usage:
#   ./scripts/db-backup.sh                       # default backup dir
#   BACKUP_DIR=/srv/backups ./scripts/db-backup.sh
#   RETAIN_DAYS=14 ./scripts/db-backup.sh        # delete older than 14d
#
# Restore drill is documented at docs/runbooks/db-restore.md.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
DB_CONTAINER="${DB_CONTAINER:-sentinel-db}"
DB_USER="${DB_USER:-sentinel}"
DB_NAME="${DB_NAME:-sentinel}"

mkdir -p "$BACKUP_DIR"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/sentinel-$TS.sql.gz"

echo "[backup] dumping $DB_NAME → $OUT"
docker exec -i "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip -9 > "$OUT"

# Verify the dump is non-empty so a botched run doesn't replace yesterday's
# good copy with a 0-byte file under retention pressure.
SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] FATAL: dump only ${SIZE} bytes — aborting + removing." >&2
  rm -f "$OUT"
  exit 1
fi

echo "[backup] dump OK (${SIZE} bytes)"

# Prune older backups. Stays within the same directory so we don't sweep
# unrelated files.
find "$BACKUP_DIR" -maxdepth 1 -name 'sentinel-*.sql.gz' -mtime "+$RETAIN_DAYS" -print -delete

echo "[backup] done. Retention: $RETAIN_DAYS days."
