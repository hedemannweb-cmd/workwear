/**
 * Fachliche Zeitzone. Kontingentjahre und "heute" werden immer in dieser Zone bestimmt,
 * damit eine Ausgabe am 01.01. um 00:30 Uhr nicht dem Vorjahr zugerechnet wird.
 */
export const APP_TIME_ZONE = "Europe/Berlin";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Kalenderdatum (YYYY-MM-DD) eines Zeitpunkts in der fachlichen Zeitzone. */
export function toIsoDateInAppTz(date: Date): string {
  return ymdFormatter.format(date);
}

export function yearInAppTz(date: Date): number {
  return Number(toIsoDateInAppTz(date).slice(0, 4));
}

export function currentYear(now: Date = new Date()): number {
  return yearInAppTz(now);
}

/**
 * Wandelt ein reines Datum (YYYY-MM-DD) in ein Date um, wie Prisma es für `@db.Date` erwartet
 * (UTC-Mitternacht).
 */
export function dateOnly(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Ungültiges Datum: ${isoDate}`);
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Gegenstück zu dateOnly: `@db.Date`-Werte sind UTC-Mitternacht. */
export function isoFromDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayDateOnly(now: Date = new Date()): Date {
  return dateOnly(toIsoDateInAppTz(now));
}

const deDate = new Intl.DateTimeFormat("de-DE", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const deDateTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "–";
  const d = typeof date === "string" ? new Date(date) : date;
  // reine Datumswerte (UTC-Mitternacht) nicht in eine andere Zone verschieben
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  }
  return deDate.format(d);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "–";
  return deDateTime.format(typeof date === "string" ? new Date(date) : date);
}

const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, timeZoneName: "longOffset" });

/** Zeitpunkt 00:00 Uhr (fachliche Zeitzone) des angegebenen Kalendertags, z. B. für Monats-/Jahresgrenzen. */
export function startOfDayInAppTz(isoDate: string): Date {
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);
  const tz = offsetFormatter.formatToParts(utcMidnight).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(utcMidnight.getTime() - offsetMinutes * 60_000);
}

/**
 * Kalenderdatum (YYYY-MM-DD) plus n Monate. Gibt es den Tag im Zielmonat nicht,
 * gilt der Monatsletzte (31.01. + 1 Monat → 28./29.02.).
 */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}
