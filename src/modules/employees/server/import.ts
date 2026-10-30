import "server-only";
import ExcelJS from "exceljs";
import { type Actor, assertCan } from "@/server/actor";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { runInTransaction } from "@/server/tx";
import {
  IMPORT_COLUMNS,
  type ImportContext,
  type ImportRowResult,
  mapHeaders,
  MAX_IMPORT_ROWS,
  type RawImportRow,
  STATUS_LABELS,
  validateImportRows,
} from "../import-rows";
import { insertEmployee } from "./employees";

/**
 * Excel-Import von Mitarbeitern (.xlsx). Ablauf: Vorschau prüft jede Zeile, der Import prüft dieselbe
 * Datei erneut und legt nur fehlerfreie, neue Mitarbeiter an. Vorhandene Personalnummern werden
 * übersprungen, nicht überschrieben.
 */

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const TEMPLATE_ROWS = 1000;

/** Excel-Zellwert auf einen einfachen Wert reduzieren (Rich Text, Formeln, Links). */
function plainCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("richText" in value) return value.richText.map((r) => r.text).join("");
  if ("formula" in value || "sharedFormula" in value) return plainCellValue((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  if ("text" in value) return value.text;
  if ("error" in value) return null;
  return null;
}

/** Liest das erste Blatt: Zeile 1 = Überschriften, danach Daten. */
export async function readEmployeeWorkbook(file: ArrayBuffer): Promise<RawImportRow[]> {
  if (file.byteLength === 0) throw new DomainError("VALIDATION", "Die Datei ist leer.");
  if (file.byteLength > MAX_IMPORT_BYTES) throw new DomainError("VALIDATION", "Die Datei ist zu groß (höchstens 4 MB).");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file);
  } catch {
    throw new DomainError("VALIDATION", "Die Datei konnte nicht gelesen werden. Bitte eine Excel-Datei im Format .xlsx verwenden.");
  }
  const ws = wb.worksheets.find((s) => s.name === "Mitarbeiter") ?? wb.worksheets[0];
  if (!ws) throw new DomainError("VALIDATION", "Die Datei enthält kein Tabellenblatt.");

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= Math.max(headerRow.cellCount, IMPORT_COLUMNS.length); c++) headers.push(String(plainCellValue(headerRow.getCell(c).value) ?? ""));
  const { columns, missing } = mapHeaders(headers);
  if (missing.length) {
    throw new DomainError("VALIDATION", `Folgende Spalten fehlen in Zeile 1: ${missing.join(", ")}. Bitte die Vorlage verwenden.`);
  }

  const rows: RawImportRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: RawImportRow["values"] = {};
    let empty = true;
    for (const [key, index] of Object.entries(columns)) {
      const v = plainCellValue(row.getCell(index + 1).value);
      if (v !== null && v !== "") empty = false;
      values[key as keyof typeof values] = v;
    }
    if (empty) continue;
    rows.push({ rowNumber: r, values });
    if (rows.length > MAX_IMPORT_ROWS) throw new DomainError("VALIDATION", `Höchstens ${MAX_IMPORT_ROWS} Mitarbeiter pro Import.`);
  }
  if (rows.length === 0) throw new DomainError("VALIDATION", "Die Datei enthält keine Mitarbeiterzeilen.");
  return rows;
}

async function scopedDepartments(actor: Actor) {
  return db.department.findMany({
    where: { active: true, ...(actor.departmentIds ? { id: { in: actor.departmentIds } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
}

async function importContext(actor: Actor, rows: RawImportRow[]): Promise<ImportContext> {
  const numbers = [...new Set(rows.map((r) => String(r.values.employeeNumber ?? "").trim()).filter(Boolean))];
  const [departments, existing, sameNames] = await Promise.all([
    scopedDepartments(actor),
    db.employee.findMany({ where: { employeeNumber: { in: numbers, mode: "insensitive" } }, select: { employeeNumber: true } }),
    // Namenshinweise nur aus den eigenen Abteilungen (keine fremden Personalnummern offenlegen)
    db.employee.findMany({
      where: {
        ...(actor.departmentIds ? { departmentId: { in: actor.departmentIds } } : {}),
        lastName: { in: [...new Set(rows.map((r) => String(r.values.lastName ?? "").trim()).filter(Boolean))], mode: "insensitive" },
      },
      select: { employeeNumber: true, firstName: true, lastName: true },
    }),
  ]);
  const existingNames = new Map<string, string[]>();
  for (const e of sameNames) {
    const key = `${e.lastName}|${e.firstName}`.toLowerCase();
    existingNames.set(key, [...(existingNames.get(key) ?? []), e.employeeNumber]);
  }
  return { departments, existingNumbers: new Set(existing.map((e) => e.employeeNumber.toLowerCase())), existingNames };
}

export type ImportPreview = {
  rows: ImportRowResult[];
  counts: { new: number; duplicate: number; error: number; warning: number };
};

function summarize(results: ImportRowResult[]): ImportPreview {
  return {
    rows: results.map((r) => ({ ...r, input: undefined })),
    counts: {
      new: results.filter((r) => r.result === "new").length,
      duplicate: results.filter((r) => r.result === "duplicate").length,
      error: results.filter((r) => r.result === "error").length,
      warning: results.filter((r) => r.warnings.length > 0).length,
    },
  };
}

export async function previewEmployeeImport(actor: Actor, file: ArrayBuffer): Promise<ImportPreview> {
  assertCan(actor, "employee:import");
  const rows = await readEmployeeWorkbook(file);
  return summarize(validateImportRows(rows, await importContext(actor, rows)));
}

/** Legt alle fehlerfreien, neuen Zeilen in einer Transaktion an. Fehlerhafte und vorhandene werden übersprungen. */
export async function commitEmployeeImport(actor: Actor, file: ArrayBuffer, fileName: string) {
  assertCan(actor, "employee:import");
  const rows = await readEmployeeWorkbook(file);
  const results = validateImportRows(rows, await importContext(actor, rows));
  const toCreate = results.filter((r) => r.result === "new" && r.input);
  if (toCreate.length === 0) throw new DomainError("VALIDATION", "Die Datei enthält keine neuen, fehlerfreien Mitarbeiter.");
  const source = `Excel-Import ${fileName}`.slice(0, 200);
  await runInTransaction(async (tx) => {
    for (const r of toCreate) await insertEmployee(tx, actor.userId, r.input!, source);
  });
  return { created: toCreate.length, skipped: results.length - toCreate.length };
}

/** Vorlage mit Kopfzeile, Auswahllisten für Abteilung und Status, Abteilungsliste und Hinweisen. */
export async function buildEmployeeImportTemplate(actor: Actor): Promise<ArrayBuffer> {
  assertCan(actor, "employee:import");
  const departments = await scopedDepartments(actor);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Arbeitskleidungsverwaltung";

  const ws = wb.addWorksheet("Mitarbeiter", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header}*` : c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  IMPORT_COLUMNS.forEach((c, i) => {
    if (c.hint) header.getCell(i + 1).note = c.hint;
  });

  const col = (key: string) => IMPORT_COLUMNS.findIndex((c) => c.key === key) + 1;
  // Personalnummer als Text, damit führende Nullen erhalten bleiben
  ws.getColumn(col("employeeNumber")).numFmt = "@";
  ws.getColumn(col("entryDate")).numFmt = "dd.mm.yyyy";
  ws.getColumn(col("exitDate")).numFmt = "dd.mm.yyyy";
  const statusList = `"${Object.values(STATUS_LABELS).join(",")}"`;
  for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
    if (departments.length) {
      ws.getCell(r, col("department")).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Abteilungen!$B$2:$B$${departments.length + 1}`],
        showErrorMessage: false,
      };
    }
    ws.getCell(r, col("status")).dataValidation = { type: "list", allowBlank: true, formulae: [statusList] };
    for (const key of ["entryDate", "exitDate"]) {
      ws.getCell(r, col(key)).dataValidation = {
        type: "date",
        operator: "greaterThan",
        allowBlank: true,
        formulae: [new Date(Date.UTC(1950, 0, 1))],
        showErrorMessage: true,
        errorTitle: "Ungültiges Datum",
        error: "Bitte ein Datum im Format TT.MM.JJJJ eingeben.",
      };
    }
  }

  const deptSheet = wb.addWorksheet("Abteilungen", { views: [{ state: "frozen", ySplit: 1 }] });
  deptSheet.columns = [
    { header: "Kürzel", key: "code", width: 14 },
    { header: "Name", key: "name", width: 32 },
  ];
  deptSheet.getRow(1).font = { bold: true };
  for (const d of departments) deptSheet.addRow({ code: d.code, name: d.name });

  const help = wb.addWorksheet("Hinweise");
  help.getColumn(1).width = 20;
  help.getColumn(2).width = 90;
  help.addRow(["Mitarbeiter-Import"]).font = { bold: true, size: 14 };
  help.addRow([]);
  help.addRow(["Ablauf", "Blatt „Mitarbeiter“ ausfüllen (ab Zeile 2, eine Zeile je Mitarbeiter), Datei speichern und unter Mitarbeiter › Excel-Import hochladen."]);
  help.addRow(["", "Vor dem Speichern zeigt die Vorschau jede Zeile mit Fehlern und Hinweisen. Nur fehlerfreie, neue Mitarbeiter werden angelegt."]);
  help.addRow(["", "Personalnummern, die es schon gibt, werden übersprungen (keine Änderung bestehender Mitarbeiter)."]);
  help.addRow([]);
  help.addRow(["Spalte", "Bedeutung"]).font = { bold: true };
  for (const c of IMPORT_COLUMNS) help.addRow([c.header + (c.required ? " (Pflicht)" : ""), c.hint || "Text"]);
  help.addRow([]);
  help.addRow(["Hinweis", "Die Abteilung bestimmt das Kontingentprofil. Größen werden nach dem Import am Mitarbeiter gepflegt."]);
  help.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
