#!/usr/bin/env bash
# Phase 5.4 — Postgres restore drill script.
#
# Restores a backup file produced by db-backup.sh INTO A FRESH DATABASE so
# you can drill the recovery path without nuking the live DB. The default
# target is `sentinel_restore_drill`, which gets dropped + recreated each
# run. Pass DB_NAME to redirect, eg DB_NAME=sentinel for a real prod
# restore (then make sure the app is stopped first).
#
# Usage:
#   ./scripts/db-restore.sh backups/sentinel-20260616T040000Z.sql.gz
#   DB_NAME=sentinel_restore_drill ./scripts/db-restore.sh path/to/dump.sql.gz
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <backup-file.sql.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"
DB_CONTAINER="${DB_CONTAINER:-sentinel-db}"
DB_USER="${DB_USER:-sentinel}"
DB_NAME="${DB_NAME:-sentinel_restore_drill}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore] FATAL: $BACKUP_FILE not found." >&2
  exit 1
fi

if [ "$DB_NAME" = "sentinel" ]; then
  echo "[restore] WARNING — target is the live 'sentinel' database."
  echo "[restore] Stop the backend container first, then re-run with:"
  echo "[restore]   FORCE=1 DB_NAME=sentinel $0 $BACKUP_FILE"
  if [ "${FORCE:-0}" != "1" ]; then
    exit 1
  fi
fi

echo "[restore] drop + recreate $DB_NAME"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"

echo "[restore] streaming dump into $DB_NAME"
gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"

echo "[restore] sanity check — count rows in approvals table:"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) FROM approvals;"

echo "[restore] done. Database '$DB_NAME' is ready."
