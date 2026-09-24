#!/bin/sh
# Sicherung der PostgreSQL-Datenbank (Custom-Format, komprimiert) nach ./backups.
# Aufbewahrung: 14 tägliche Sicherungen (älteste werden gelöscht). Für Cron geeignet:
#   15 2 * * *  cd /opt/arbeitskleidung && ./scripts/backup.sh >> backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
STAMP=$(date +%Y-%m-%d_%H%M)
FILE="arbeitskleidung_${STAMP}.dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/${FILE}"
# Plausibilitätsprüfung: Dump muss lesbar sein
docker compose exec -T postgres pg_restore --list "/backups/${FILE}" > /dev/null
echo "$(date -Iseconds) Backup OK: backups/${FILE} ($(du -h "backups/${FILE}" | cut -f1))"
ls -1t backups/arbeitskleidung_*.dump | tail -n +15 | xargs -r rm --
