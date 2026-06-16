# Postgres Restore Runbook

Phase 5.4 deliverable. Walks through restoring a Sentinel Postgres backup
in both drill and live-recovery modes.

## When to use

- **Drill (weekly):** verify backups are valid + the restore path still
  works. Default target is `sentinel_restore_drill` — a throwaway DB.
- **Live recovery:** something corrupted the prod `sentinel` database
  (botched migration, accidental DROP, hardware loss). Restore the most
  recent backup that predates the corruption.

## Drill mode (safe, weekly)

```bash
# Find the most recent backup
ls -t backups/sentinel-*.sql.gz | head -1

# Restore into the drill DB (default DB_NAME=sentinel_restore_drill)
./scripts/db-restore.sh backups/sentinel-20260616T040000Z.sql.gz
```

The script DROPs + CREATEs the drill DB before streaming the dump in, then
runs a sanity `SELECT COUNT(*) FROM approvals;` to prove the restore
worked. If the count is non-zero, the backup is good.

Drop the drill DB when done if you want to reclaim space:

```bash
docker exec -i sentinel-db psql -U sentinel -d postgres \
  -c "DROP DATABASE sentinel_restore_drill;"
```

## Live recovery mode (destructive)

1. **Stop the backend container.** Skipping this risks the app writing
   half-states during restore.

   ```bash
   docker compose stop backend
   ```

2. **Pick the right backup.** Newest backup that predates the corruption.
   Use `gunzip -c FILE | head` to spot-check the dump header if unsure.

3. **Run the restore with explicit confirmation.**

   ```bash
   FORCE=1 DB_NAME=sentinel ./scripts/db-restore.sh \
     backups/sentinel-20260616T040000Z.sql.gz
   ```

   Without `FORCE=1`, the script refuses to clobber the live DB. The flag
   exists to prevent muscle-memory accidents.

4. **Restart the backend.**

   ```bash
   docker compose start backend
   ```

5. **Verify in the UI:** log in, open /approvals, /incidents, /audit.
   Check the audit trail's most recent event timestamp matches what you
   expected (the backup's snapshot point).

## Scheduling daily backups

Add a cron entry on the host running Docker:

```cron
0 3 * * * cd /path/to/Harness && ./scripts/db-backup.sh >> backups/backup.log 2>&1
```

Default retention is 7 days. Override via `RETAIN_DAYS=14`.

## Known gotchas

- The dump only contains the `sentinel` Postgres database, NOT the user's
  encrypted `.env` (which lives on host disk). Keep both backed up.
- `docker exec` requires the `sentinel-db` container to be running. If
  it's down, start it first: `docker compose up -d postgres`.
- If you rename the DB container in compose, override `DB_CONTAINER`:
  `DB_CONTAINER=my-pg ./scripts/db-backup.sh`.
