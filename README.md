# Arbeitskleidungsverwaltung

Interne Web-Anwendung zur Verwaltung von Arbeitskleidung: Mitarbeiterkontingente, Ausgaben, Lagerbestände, Bestellungen und Wareneingang. Sie ersetzt die bisherige Excel-Lösung.

Architektur und fachliche Entscheidungen stehen in [docs/KONZEPT.md](docs/KONZEPT.md) (freigegeben am 24.09.2026, inkl. BDR-1 bis BDR-14).

## Inhalt

- [Funktionsumfang](#funktionsumfang)
- [Technik und Architektur](#technik-und-architektur)
- [Voraussetzungen](#voraussetzungen)
- [Installation und lokale Entwicklung](#installation-und-lokale-entwicklung)
- [Umgebungsvariablen](#umgebungsvariablen)
- [PostgreSQL-Setup](#postgresql-setup)
- [Prisma-Migrationen](#prisma-migrationen)
- [Seed und Demodaten](#seed-und-demodaten)
- [Tests](#tests)
- [Build](#build)
- [Docker](#docker)
- [Backup und Restore](#backup-und-restore)
- [Deployment](#deployment)
- [Sicherheit und Datenschutz](#sicherheit-und-datenschutz)
- [Umsetzungsstand](#umsetzungsstand)

---

## Funktionsumfang

| Bereich | Funktionen |
|---|---|
| **Mitarbeiter** | Liste, Anlage und Bearbeitung, Größen je Größenskala (mit Abweichung je Kategorie), historisierter Abteilungswechsel, Pseudonymisierung nach Ablauf der Aufbewahrungsfrist (1 Jahr) |
| **Mitarbeiterdetailseite** | Kontingent je Jahr (Anspruch, Anpassung, Erhalten, Reserviert, Verfügbar) mit Nachweis je Buchung, offene Bestellungen, Historie, Größen |
| **Ausgabe/Bestellung** | Ein Dialog: Gruppe → Größe (Mitarbeitergröße vorbelegt, Bestand je Größe) → *Ausgeben* oder *Bestellen*. Sonderfreigabe über das Kontingent hinaus für Manager und Admins |
| **Rückgabe/Umtausch** | Rückgabe ins Lager (nur ungetragen), Reklamation, Abschreibung, Größentausch ohne doppelte Kontingentbelastung |
| **Bestellungen** | Bedarf aus Mitarbeiteranforderungen, Sammelbestellung je Lieferant, Lagerbestellung mit Bestellvorschlag (nie automatisch versendet), CSV-Export für den Lieferanten |
| **Wareneingang** | Teillieferungen, FIFO-Zuteilung an Mitarbeiter (mit Split), Direktausgabe oder reservierte Einlagerung |
| **Lager** | Bestand je Variante × Lagerort (physisch/reserviert/frei), Mindestbestand mit Mail-Benachrichtigung (einmal je Unterschreitung), Zählung und Korrektur, Umlagerung, unveränderliches Bewegungsjournal |
| **Dashboard** | Kennzahlen, Handlungsbedarf, Artikel unter Mindestbestand, Datenqualität |
| **Administration** | Kontingentgruppen und -profile mit versionierten Jahresregeln, Lieferanten, Benutzer und Rollen (Abteilungsbeschränkung), Einstellungen, Audit Log |
| **Suche** | ⌘K / Strg+K: fehlertolerante Suche (Name, Personalnummer, SKU, Bestellnummer) mit Kontingent-Schnellansicht |

## Technik und Architektur

- **Next.js 16** (App Router, Server Actions, Turbopack), **React 19**, **TypeScript**
- **PostgreSQL 17**, **Prisma 7** (Driver Adapter `@prisma/adapter-pg`)
- **Better Auth** (E-Mail/Passwort, Sessions in der DB, Rate Limiting)
- **Tailwind CSS 4**, **shadcn/ui** (Radix), **Lucide**, **TanStack Table 9**, **React Hook Form** + **Zod 4**
- **Vitest** (Unit + Integration gegen echtes PostgreSQL), **Playwright** (E2E)

```
src/
  app/                 Routing und Seiten (dünn, ohne Geschäftslogik)
  modules/<modul>/
    domain/            reine Fachlogik ohne DB/Framework (z. B. computeQuota)
    server/            Domänenprozesse und Abfragen (import "server-only")
    actions.ts         Server Actions: Session → Domänenfunktion → Revalidierung
  server/              technischer Kern: db, tx (Sperren), auth, permissions, audit, errors, numbering
  components/          ui (shadcn), shared (DataTable, StatusBadge, …), layout
prisma/                schema.prisma, migrations (inkl. handgeschriebener Constraints), seed.ts
tests/integration/     Domänentests gegen PostgreSQL (inkl. Nebenläufigkeit)
tests/e2e/             Playwright-Kernabläufe
```

**Kernprinzipien**

- **Kontingent wird berechnet, nie gespeichert.** Die Formel lautet `Anspruch + Anpassungen − (Ausgaben − Gutschriften) − aktive Reservierungen`. Sie steckt in einer reinen, getesteten Funktion (`modules/quotas/domain/compute-quota.ts`), die alle Stellen über `getEmployeeQuota()` nutzen.
- **Lager = Journal + Projektion.** Bestände ändern sich nur zusammen mit einer `InventoryMovement` in derselben Transaktion (`modules/inventory/server/stock.ts`). CHECK-Constraints verhindern negative Bestände.
- **Nebenläufigkeit.** Kontingentvorgänge sperren die Zeile „Mitarbeiter × Jahr“ (`SELECT … FOR UPDATE`), Lagerbuchungen sind bedingte atomare Updates. So kann dieselbe letzte Hose nicht zweimal ausgegeben werden; Tests dazu liegen in `tests/integration`.
- **Nichts wird gelöscht.** Korrekturen erfolgen über Storno oder Gegenbuchung, Stammdaten werden deaktiviert. Audit Log und Bewegungsjournal sind per Datenbank-Trigger unveränderlich.

## Voraussetzungen

- **Node.js 22 LTS oder neuer** (Docker-Image: Node 24 LTS)
- **PostgreSQL 17** (lokal per Homebrew oder Docker)
- Für Docker-Betrieb: Docker Engine mit Compose v2

## Installation und lokale Entwicklung

```bash
npm install
```

```bash
cp .env.example .env
```

Danach `.env` anpassen (siehe unten), Datenbanken anlegen, migrieren und Demodaten einspielen:

```bash
npm run db:deploy
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Die Anwendung läuft unter http://localhost:3000. Anmeldung mit `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Mit Demodaten gibt es zusätzlich `manager@example.com` (Manager) und `lager@example.com` (Verantwortlicher, nur Abteilung Lager).

Nützliche Befehle:

| Befehl | Zweck |
|---|---|
| `npm run check` | TypeScript, ESLint, Unit- und Integrationstests |
| `npm run db:migrate` | neue Migration aus Schemaänderung erzeugen (Entwicklung) |
| `npx prisma studio` | Datenbank ansehen |

## Umgebungsvariablen

Alle Variablen sind in [.env.example](.env.example) dokumentiert. Die wichtigsten:

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ja | PostgreSQL-Verbindung |
| `BETTER_AUTH_SECRET` | ja | ≥ 32 zufällige Zeichen (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | ja | Öffentliche URL der Anwendung (in Produktion `https://…`) |
| `TEST_DATABASE_URL` | für Tests | Eigene Test-DB, Name endet auf `_test`; wird von Tests geleert |
| `AUTH_SIGNIN_RATE_LIMIT` | nein | Anmeldeversuche pro Minute und IP (Standard 10) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | nein | Mailversand für die Mindestbestands-Benachrichtigung (Empfänger unter Administration → Einstellungen). Ohne `SMTP_HOST` werden keine Mails verschickt. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | für Seed | Erster Administrator; danach aus `.env` entfernen |
| `SEED_DEMO` | nein | `false` = keine Demodaten |
| `POSTGRES_*`, `APP_*` | Docker | siehe `.env.example` |

Die Anwendung prüft die Konfiguration beim Start (`src/instrumentation.ts`) und bricht mit einer verständlichen Meldung ab, wenn Werte fehlen oder ungültig sind.

## PostgreSQL-Setup

**macOS (Homebrew):**

```bash
brew install postgresql@17
```

```bash
brew services start postgresql@17
```

```bash
createdb arbeitskleidung && createdb arbeitskleidung_test
```

**Oder per Docker (nur Datenbank):**

```bash
docker compose up -d postgres
```

Die Migrationen legen die benötigten Extensions `pg_trgm` (fehlertolerante Suche) und `btree_gist` (überlappungsfreie Abteilungshistorie) selbst an. Der Datenbankbenutzer braucht dafür beim ersten Migrieren die Berechtigung `CREATE` auf der Datenbank (bei Docker gegeben).

## Prisma-Migrationen

- `prisma/migrations/*_init`: von Prisma erzeugtes Schema
- `prisma/migrations/*_constraints`: **handgeschriebene** CHECK-Constraints, partielle und NULLS-NOT-DISTINCT-Unique-Indizes, Exclusion-Constraint, Trigram-Indizes, Belegnummern-Sequenzen und Unveränderlichkeits-Trigger

| Situation | Befehl |
|---|---|
| Produktion / Docker | `npm run db:deploy` (wendet nur vorhandene Migrationen an) |
| Schemaänderung in der Entwicklung | `npm run db:migrate -- --name beschreibung` |

Nach einer Schemaänderung prüfen, dass `npx prisma migrate dev --create-only` keine unerwarteten `DROP`-Anweisungen für die handgeschriebenen Indizes erzeugt. Sie sind im Schema per `map:` deklariert.

## Seed und Demodaten

`npm run db:seed` legt an: Lagerorte, Größenskalen (Textil XS–3XL, Hosen 46–60, Schuhe 39–48), Einstellungen und den ersten Administrator. Mit Demodaten kommen hinzu: 3 Abteilungen mit Kontingentprofilen, 17 Mitarbeiter, 7 Artikel mit Varianten, Lieferanten, reichliche, knappe und fehlende Bestände, historische Ausgaben, Reservierungen sowie Bestellungen in allen Zuständen (überfällig, Teillieferung, geliefert, storniert, Entwurf).

Alle Bewegungsdaten entstehen über die echten Domänenprozesse. Der Seed ist idempotent: Existieren bereits Benutzer, wird er übersprungen.

Für die **Produktion** nur den Administrator anlegen:

```bash
SEED_DEMO=false npm run db:seed
```

## Tests

| Befehl | Inhalt |
|---|---|
| `npm run test:unit` | reine Fachlogik: Kontingentformel, anteiliger Anspruch (BDR-4), Zeitzonen, CSV |
| `npm run test:integration` | Domänenprozesse gegen PostgreSQL (`TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright gegen einen eigenen Dev-Server auf Port 3100 und die Test-DB |

Abgedeckt sind unter anderem: Teilabruf, vollständiger Verbrauch, verhinderte Überschreitung, Admin-Sonderfreigabe, individuelle Anpassung, Reservierung und Stornierung, Lager- und Kontingentwirkung einer Ausgabe, Rückgabe, Umtausch (auch über den Jahreswechsel), Teillieferung mit FIFO-Split, Abteilungswechsel, Jahreswechsel und Regelversionierung, **gleichzeitige Ausgabe und Reservierung durch zwei Benutzer**, das nicht negativ werdende Lager (auch per direktem SQL), unveränderliche Journale, Abteilungs-Scope und Idempotenz.

Für die E2E-Tests einmalig den Browser installieren:

```bash
npx playwright install chromium
```

Die E2E-Tests erzeugen bei jedem Lauf ein **zufälliges Einmal-Passwort** für die Testbenutzer; im Repository stehen keine Zugangsdaten.

## Build

```bash
npm run build
```

```bash
npm start
```

Der Build erzeugt eine Standalone-Ausgabe (`.next/standalone`), die das Docker-Image verwendet.

## Docker

```bash
cp .env.example .env
```

In `.env` mindestens `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` und `BETTER_AUTH_URL` setzen, dann:

```bash
docker compose up -d --build
```

| Service | Aufgabe |
|---|---|
| `postgres` | PostgreSQL 17 mit persistentem Volume `pgdata`, Healthcheck, kein offener Port |
| `migrate` | wendet beim Start alle Migrationen an (`prisma migrate deploy`) und beendet sich |
| `app` | Next.js (Standalone, läuft ohne Root), startet erst nach erfolgreicher Migration, Healthcheck `/api/health` |
| `caddy` | optionaler HTTPS-Reverse-Proxy (Profil `proxy`) |

**Erster Start: Administrator anlegen** (ohne Demodaten):

```bash
docker compose run --rm -e SEED_DEMO=false -e SEED_ADMIN_EMAIL=it@firma.de -e SEED_ADMIN_PASSWORD='…' migrate npx tsx --conditions=react-server prisma/seed.ts
```

**Update auf eine neue Version:**

```bash
git pull && docker compose up -d --build
```

Migrationen laufen dabei automatisch vor dem App-Start.

## Backup und Restore

Die Datenbank enthält historische Unternehmensdaten (Ausgaben, Bewegungen, Audit Log). **Sichern Sie täglich und prüfen Sie die Wiederherstellung regelmäßig.**

**Backup** (Custom-Format, komprimiert, mit Lesbarkeitsprüfung; behält die letzten 14 Sicherungen in `./backups`):

```bash
./scripts/backup.sh
```

Täglich per Cron, z. B. um 02:15 Uhr:

```
15 2 * * *  cd /opt/arbeitskleidung && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**Empfohlene Strategie:**

1. Tägliche Sicherung nach `./backups` (Skript oben).
2. Das Verzeichnis `backups/` zusätzlich **außerhalb des Servers** sichern, z. B. über die vorhandene Datensicherung oder ein NAS (3-2-1-Regel).
3. **Monatlicher Restore-Test** auf einem Testsystem.
4. Vor jedem Update zusätzlich manuell sichern.

**Restore** (ersetzt den aktuellen Datenbestand; fragt zur Sicherheit nach):

```bash
./scripts/restore.sh backups/arbeitskleidung_2026-09-24_0215.dump
```

Das Skript stoppt die App, spielt die Sicherung ein, wendet ggf. neuere Migrationen an und startet die App wieder.

Ohne Docker funktioniert dasselbe mit `pg_dump -Fc` und `pg_restore --clean --if-exists --no-owner`.

## Deployment

1. Server mit Docker vorbereiten, Repository nach z. B. `/opt/arbeitskleidung` klonen.
2. `.env` aus `.env.example` erstellen und **starke, zufällige Secrets** setzen (Datei nur für root lesbar: `chmod 600 .env`).
3. **HTTPS ist Pflicht:** In Produktion sind die Anmelde-Cookies als `Secure` markiert und funktionieren nur über HTTPS.
   - Vorhandener Unternehmens-Proxy: dort auf `127.0.0.1:3000` weiterleiten.
   - Kein Proxy vorhanden: `APP_DOMAIN` setzen und `docker compose --profile proxy up -d --build` starten (Caddy, siehe `docker/Caddyfile`).
4. `BETTER_AUTH_URL` auf die öffentliche HTTPS-Adresse setzen.
5. Administrator anlegen (siehe [Docker](#docker)), anmelden, `SEED_ADMIN_PASSWORD` aus `.env` entfernen.
6. Stammdaten pflegen: Kontingentgruppen, -profile, Abteilungen, Artikel und Lieferanten, Benutzer.
7. Backup-Cronjob einrichten und einen ersten Restore-Test durchführen.

## Sicherheit und Datenschutz

- **Autorisierung serverseitig:** Jede Server Action und jede Domänenfunktion prüft Rolle und Abteilungs-Scope (`src/server/permissions.ts`). Ausgeblendete Buttons sind nur Komfort.
- **CSRF:** Server Actions prüfen den Origin, Better Auth schützt seine Endpunkte selbst. **XSS:** React escaped alle Ausgaben, es gibt kein `dangerouslySetInnerHTML`. **SQL-Injection:** nur Prisma bzw. parametrisierte `$queryRaw`-Templates.
- **Validierung:** Zod-Schemas in jeder Domänenfunktion, zusätzlich DB-Constraints.
- **Rate Limiting** für den Login, **sichere Cookies** in Produktion, Sicherheits-Header (`next.config.ts`).
- **Fehlermeldungen:** Benutzer sehen fachliche Texte („Diese Personalnummer wird bereits verwendet.“); technische Details landen nur im Server-Log (JSON-Zeilen).
- **Audit Log** ohne Passwörter, Tokens oder Secrets (Denylist) und ohne Namen oder Notizen von Mitarbeitern. Dadurch bleibt die Pseudonymisierung nach der Aufbewahrungsfrist wirksam.
- **Datensparsamkeit:** Gespeichert werden nur Personalnummer, Name, Abteilung, Ein- und Austritt, Status, Größen und arbeitsbezogene Notizen.

## Umsetzungsstand

**Phase 1 (MVP) ist vollständig umgesetzt**, einschließlich des vorgezogenen Wareneingangs. **Aus Phase 2 bereits enthalten:** Sammelbestellungen, Teillieferungen, Rückgabe und Umtausch, Datenqualitätsprüfung, Lagerbestellung mit Bestellvorschlag.

**Noch offen (Phase 2):**
- Auswertungen/Reports inkl. CSV- und Excel-Export. Die Daten dafür (Kosten-Snapshots je Ausgabe, Journal) liegen bereits vor.
- Excel-Import-Assistent. Der Baustein für historische Ausgaben (`modules/import/server/historical-issues.ts`) ist vorhanden und wird vom Seed genutzt.
- Kostenbewertung per gleitendem Durchschnitt (BDR-9, aktuell Vorzugslieferantenpreis).

**Phase 3:** Barcode/QR, Inventurmodus, mehrere Lagerorte in der Oberfläche, Kostenstellen und Budgets, E-Mail-Benachrichtigungen, Mandanten, Mehrsprachigkeit. Das Datenmodell ist dafür vorbereitet (Barcode-Feld, Lagerorte, Kostenstelle an der Abteilung, Notification-Tabelle).
