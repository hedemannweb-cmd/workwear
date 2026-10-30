import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildEmployeeImportTemplate, commitEmployeeImport, previewEmployeeImport } from "@/modules/employees/server/import";
import { db } from "@/server/db";
import { makeActor, resetDb } from "./fixtures";

beforeEach(async () => {
  await resetDb();
});

/** Füllt die echte Vorlage aus, so wie ein Benutzer es in Excel tun würde. */
async function filledTemplate(template: ArrayBuffer, rows: ExcelJS.CellValue[][]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template);
  const ws = wb.getWorksheet("Mitarbeiter")!;
  rows.forEach((r, i) => (ws.getRow(i + 2).values = r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("Mitarbeiter-Import aus Excel", () => {
  it("Vorlage enthält Spalten und Abteilungen, Vorschau prüft, Import legt nur neue fehlerfreie Zeilen an", async () => {
    const admin = await makeActor("ADMIN");
    const prod = await db.department.create({ data: { code: "PROD", name: "Produktion" } });
    await db.department.create({ data: { code: "ALT", name: "Alt", active: false } });
    await db.employee.create({ data: { employeeNumber: "1000", firstName: "Max", lastName: "Muster", departmentId: prod.id, entryDate: new Date("2020-01-01") } });

    const template = await buildEmployeeImportTemplate(admin);
    const check = new ExcelJS.Workbook();
    await check.xlsx.load(template);
    expect(check.getWorksheet("Mitarbeiter")!.getRow(1).getCell(1).value).toBe("Personalnummer*");
    expect(check.getWorksheet("Abteilungen")!.getRow(2).values).toEqual([undefined, "PROD", "Produktion"]);
    expect(check.getWorksheet("Abteilungen")!.rowCount).toBe(2);

    const file = await filledTemplate(template, [
      ["0815", "Meier", "Anna", "Produktion", new Date(Date.UTC(2024, 2, 1)), null, "Aktiv", "Schicht A"],
      ["1000", "Muster", "Max", "PROD", "01.01.2020"],
      ["0816", "Schulz", "Tom", "Alt", "01.01.2024"],
      ["0817", "Muster", "Max", "PROD", "15.06.2025"],
    ]);

    const preview = await previewEmployeeImport(admin, file);
    expect(preview.counts).toEqual({ new: 2, duplicate: 1, error: 1, warning: 1 });
    expect(await db.employee.count()).toBe(1);

    const result = await commitEmployeeImport(admin, file, "test.xlsx");
    expect(result).toEqual({ created: 2, skipped: 2 });
    const anna = await db.employee.findUniqueOrThrow({ where: { employeeNumber: "0815" }, include: { departmentHistory: true } });
    expect(anna).toMatchObject({ firstName: "Anna", status: "ACTIVE", notes: "Schicht A", entryDate: new Date("2024-03-01") });
    expect(anna.departmentHistory).toHaveLength(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: anna.id } });
    expect(log.action).toBe("EMPLOYEE_CREATED");
    expect(JSON.stringify(log.newValue)).not.toContain("Anna");

    // zweiter Durchlauf: alles schon vorhanden
    await expect(commitEmployeeImport(admin, file, "test.xlsx")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("eingeschränkte Benutzer importieren nur in ihre Abteilungen, ohne Recht kein Import", async () => {
    const prod = await db.department.create({ data: { code: "PROD", name: "Produktion" } });
    const lager = await db.department.create({ data: { code: "LAG", name: "Lager" } });
    const manager = await makeActor("MANAGER", [lager.id]);
    const template = await buildEmployeeImportTemplate(manager);
    const file = await filledTemplate(template, [
      ["1", "A", "B", "Lager", "01.01.2024"],
      ["2", "C", "D", "Produktion", "01.01.2024"],
    ]);
    const preview = await previewEmployeeImport(manager, file);
    expect(preview.rows.map((r) => r.result)).toEqual(["new", "error"]);
    expect(prod.id).toBeTruthy();

    const responsible = await makeActor("RESPONSIBLE");
    await expect(previewEmployeeImport(responsible, file)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("falsche Dateien werden verständlich abgelehnt", async () => {
    const admin = await makeActor("ADMIN");
    await expect(previewEmployeeImport(admin, new TextEncoder().encode("kein excel").buffer as ArrayBuffer)).rejects.toThrow("konnte nicht gelesen werden");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("X").addRow(["Name", "Vorname"]);
    await expect(previewEmployeeImport(admin, (await wb.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toThrow("Spalten fehlen");
  });
});
