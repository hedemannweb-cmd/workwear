import { employeeSchema, type EmployeeInput } from "./schemas";

/**
 * Excel-Import von Mitarbeitern: reine Prüf-Logik ohne Datenbank (testbar).
 * Das Einlesen der .xlsx-Datei und die Datenbankabgleiche liegen in server/import.ts.
 */

/** Spalten der Vorlage. Beim Einlesen wird über die Überschrift zugeordnet (Groß-/Kleinschreibung und * egal). */
export const IMPORT_COLUMNS = [
  { key: "employeeNumber", header: "Personalnummer", required: true, width: 16, hint: "Eindeutig, nur Buchstaben, Ziffern und -" },
  { key: "lastName", header: "Nachname", required: true, width: 22, hint: "" },
  { key: "firstName", header: "Vorname", required: true, width: 22, hint: "" },
  { key: "department", header: "Abteilung", required: true, width: 26, hint: "Name oder Kürzel einer aktiven Abteilung (Liste im Blatt „Abteilungen“)" },
  { key: "entryDate", header: "Eintrittsdatum", required: true, width: 15, hint: "TT.MM.JJJJ" },
  { key: "exitDate", header: "Austrittsdatum", required: false, width: 15, hint: "TT.MM.JJJJ, leer lassen wenn nicht ausgeschieden" },
  { key: "status", header: "Status", required: false, width: 15, hint: "Aktiv, Inaktiv oder Ausgeschieden (leer = Aktiv)" },
  { key: "notes", header: "Notizen", required: false, width: 40, hint: "" },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];
export type RawImportRow = { rowNumber: number; values: Partial<Record<ImportColumnKey, unknown>> };

export const MAX_IMPORT_ROWS = 2000;

export const STATUS_LABELS = { ACTIVE: "Aktiv", INACTIVE: "Inaktiv", LEFT: "Ausgeschieden" } as const;

export type ImportDepartment = { id: string; code: string; name: string };

export type ImportRowResult = {
  rowNumber: number;
  employeeNumber: string;
  name: string;
  department: string;
  entryDate: string | null;
  status: string;
  /** new = wird angelegt, duplicate = Personalnummer existiert bereits (übersprungen), error = fehlerhaft (übersprungen) */
  result: "new" | "duplicate" | "error";
  errors: string[];
  warnings: string[];
  input?: EmployeeInput;
};

const FIELD_LABELS: Record<string, string> = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.header]));
FIELD_LABELS.departmentId = "Abteilung";

const normalizeHeader = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Ordnet Überschriften Spalten zu. Liefert Spaltenindex je Schlüssel und fehlende Pflichtspalten. */
export function mapHeaders(headers: string[]): { columns: Partial<Record<ImportColumnKey, number>>; missing: string[] } {
  const columns: Partial<Record<ImportColumnKey, number>> = {};
  headers.forEach((h, i) => {
    const col = IMPORT_COLUMNS.find((c) => normalizeHeader(c.header) === normalizeHeader(h));
    if (col && columns[col.key] === undefined) columns[col.key] = i;
  });
  const missing = IMPORT_COLUMNS.filter((c) => c.required && columns[c.key] === undefined).map((c) => c.header);
  return { columns, missing };
}

/** Zellwert als getrimmter Text ("" für leer). Zahlen ohne Nachkommastellen bleiben ohne ",0" (Personalnummern). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isoFromCellDate(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  return String(value).trim();
}

const isoFromCellDate = (d: Date) => d.toISOString().slice(0, 10);

function validIso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return isoFromCellDate(date);
}

/**
 * Datum aus einer Zelle: echtes Excel-Datum, Excel-Seriennummer, TT.MM.JJJJ (auch TT.MM.JJ) oder JJJJ-MM-TT.
 * undefined = leer, null = nicht lesbar.
 */
export function parseCellDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  // Excel-Datumszellen kommen als UTC-Mitternacht
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoFromCellDate(value);
  if (typeof value === "number") {
    if (value < 1 || value > 100000) return null;
    return isoFromCellDate(new Date(Math.round((value - 25569) * 86400000)));
  }
  const s = String(value).trim();
  if (!s) return undefined;
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) - (Number(m[3]) > 50 ? 100 : 0) : Number(m[3]);
    return validIso(year, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function parseStatus(text: string): EmployeeInput["status"] | null {
  const t = text.trim().toLowerCase();
  if (!t || t === "aktiv" || t === "active") return "ACTIVE";
  if (t === "inaktiv" || t === "inactive") return "INACTIVE";
  if (t === "ausgeschieden" || t === "left") return "LEFT";
  return null;
}

/** Abteilung über Kürzel (exakt) oder Namen (eindeutig) finden, jeweils ohne Groß-/Kleinschreibung. */
function findDepartment(text: string, departments: ImportDepartment[]): ImportDepartment | "ambiguous" | null {
  const t = text.trim().toLowerCase();
  const byCode = departments.find((d) => d.code.toLowerCase() === t);
  if (byCode) return byCode;
  const byName = departments.filter((d) => d.name.trim().toLowerCase() === t);
  if (byName.length > 1) return "ambiguous";
  return byName[0] ?? null;
}

export type ImportContext = {
  /** aktive Abteilungen, auf die der Benutzer Zugriff hat */
  departments: ImportDepartment[];
  /** bereits vorhandene Personalnummern (Kleinschreibung) */
  existingNumbers: Set<string>;
  /** vorhandene Namen "nachname|vorname" (Kleinschreibung) mit ihren Personalnummern, für Hinweise */
  existingNames: Map<string, string[]>;
};

/** Prüft alle Zeilen. Leere Zeilen werden ausgelassen. */
export function validateImportRows(rows: RawImportRow[], ctx: ImportContext): ImportRowResult[] {
  const results: ImportRowResult[] = [];
  const seenNumbers = new Map<string, number>();

  for (const row of rows) {
    const text = (k: ImportColumnKey) => cellText(row.values[k]);
    if (IMPORT_COLUMNS.every((c) => !text(c.key))) continue;

    const errors: string[] = [];
    const warnings: string[] = [];
    const employeeNumber = text("employeeNumber");
    const firstName = text("firstName");
    const lastName = text("lastName");
    const departmentText = text("department");

    const department = departmentText ? findDepartment(departmentText, ctx.departments) : null;
    if (!departmentText) errors.push("Abteilung: Pflichtfeld");
    else if (department === "ambiguous") errors.push(`Abteilung „${departmentText}“ ist nicht eindeutig, bitte das Kürzel angeben`);
    else if (!department) errors.push(`Abteilung „${departmentText}“ nicht gefunden oder nicht aktiv`);

    const entryDate = parseCellDate(row.values.entryDate);
    if (entryDate === null) errors.push(`Eintrittsdatum „${text("entryDate")}“ ist kein gültiges Datum`);
    const exitDate = parseCellDate(row.values.exitDate);
    if (exitDate === null) errors.push(`Austrittsdatum „${text("exitDate")}“ ist kein gültiges Datum`);
    const status = parseStatus(text("status"));
    if (!status) errors.push(`Status „${text("status")}“ unbekannt (erlaubt: Aktiv, Inaktiv, Ausgeschieden)`);

    const candidate = {
      employeeNumber,
      firstName,
      lastName,
      departmentId: department && department !== "ambiguous" ? department.id : "",
      entryDate: entryDate ?? "",
      exitDate: exitDate ?? null,
      status: status ?? "ACTIVE",
      notes: text("notes") || null,
    };
    const parsed = employeeSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        // Fehler, die oben schon genauer gemeldet wurden, nicht doppelt zeigen
        if (field === "departmentId" && departmentText) continue;
        if ((field === "entryDate" && entryDate === null) || (field === "exitDate" && exitDate === null)) continue;
        errors.push(`${FIELD_LABELS[field] ?? field}: ${issue.message}`);
      }
    }

    const numberKey = employeeNumber.toLowerCase();
    let result: ImportRowResult["result"] = errors.length ? "error" : "new";
    if (employeeNumber) {
      const firstRow = seenNumbers.get(numberKey);
      if (firstRow !== undefined) {
        errors.push(`Personalnummer kommt in der Datei mehrfach vor (zuerst in Zeile ${firstRow})`);
        result = "error";
      } else {
        seenNumbers.set(numberKey, row.rowNumber);
        if (ctx.existingNumbers.has(numberKey) && result !== "error") result = "duplicate";
      }
    }
    if (result === "new") {
      const others = ctx.existingNames.get(`${lastName}|${firstName}`.toLowerCase());
      if (others?.length) warnings.push(`Gleicher Name bereits vorhanden (Personalnummer ${others.join(", ")}). Wird trotzdem angelegt.`);
    }

    results.push({
      rowNumber: row.rowNumber,
      employeeNumber,
      name: [lastName, firstName].filter(Boolean).join(", "),
      department: department && department !== "ambiguous" ? department.name : departmentText,
      entryDate: entryDate ?? null,
      status: status ? STATUS_LABELS[status] : text("status"),
      result,
      errors: result === "duplicate" ? ["Personalnummer existiert bereits, Zeile wird übersprungen"] : errors,
      warnings,
      input: result === "new" && parsed.success ? parsed.data : undefined,
    });
  }
  return results;
}
