#!/bin/sh
# Wiederherstellung einer Sicherung. ACHTUNG: ersetzt den aktuellen Datenbestand vollständig.
#   ./scripts/restore.sh backups/arbeitskleidung_2026-09-24_0215.dump
set -eu
cd "$(dirname "$0")/.."
FILE="${1:?Bitte Sicherungsdatei angeben, z. B. backups/arbeitskleidung_YYYY-MM-DD_HHMM.dump}"
[ -f "$FILE" ] || { echo "Datei $FILE nicht gefunden"; exit 1; }
printf "Aktuelle Datenbank wird durch %s ersetzt. Fortfahren? [ja/NEIN] " "$FILE"
read -r ANSWER
[ "$ANSWER" = "ja" ] || { echo "Abgebrochen."; exit 1; }
docker compose stop app
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$FILE"
docker compose run --rm migrate
docker compose start app
echo "Wiederherstellung abgeschlossen."
