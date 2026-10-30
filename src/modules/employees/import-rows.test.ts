import { describe, expect, it } from "vitest";
import { type ImportContext, mapHeaders, parseCellDate, type RawImportRow, validateImportRows } from "./import-rows";

const ctx: ImportContext = {
  departments: [
    { id: "d1", code: "PROD", name: "Produktion" },
    { id: "d2", code: "LAG", name: "Lager" },
    { id: "d3", code: "LAG2", name: "Lager" },
  ],
  existingNumbers: new Set(["1000"]),
  existingNames: new Map([["muster|max", ["1000"]]]),
};

const row = (rowNumber: number, values: RawImportRow["values"]): RawImportRow => ({
  rowNumber,
  values: { employeeNumber: `P${rowNumber}`, lastName: "Meier", firstName: "Anna", department: "PROD", entryDate: "01.03.2024", ...values },
});

describe("Mitarbeiter-Import: Zeilenprüfung", () => {
  it("ordnet Überschriften unabhängig von Groß-/Kleinschreibung und * zu und meldet fehlende Pflichtspalten", () => {
    expect(mapHeaders(["personalnummer*", "Nachname", "VORNAME", "Abteilung*", "Eintrittsdatum"]).missing).toEqual([]);
    expect(mapHeaders(["Personalnummer", "Nachname"]).missing).toEqual(["Vorname", "Abteilung", "Eintrittsdatum"]);
  });

  it("liest Datumswerte aus Excel-Datum, Seriennummer und Text", () => {
    expect(parseCellDate(new Date(Date.UTC(2024, 2, 1)))).toBe("2024-03-01");
    expect(parseCellDate(45352)).toBe("2024-03-01");
    expect(parseCellDate("1.3.2024")).toBe("2024-03-01");
    expect(parseCellDate("01.03.24")).toBe("2024-03-01");
    expect(parseCellDate("2024-03-01")).toBe("2024-03-01");
    expect(parseCellDate("31.02.2024")).toBeNull();
    expect(parseCellDate("morgen")).toBeNull();
    expect(parseCellDate("")).toBeUndefined();
  });

  it("gültige Zeile wird neu angelegt, Abteilung per Kürzel oder Name, Status-Text wird übersetzt", () => {
    const [a, b] = validateImportRows([row(2, {}), row(3, { department: "produktion", status: "Inaktiv", employeeNumber: 4711 })], ctx);
    expect(a).toMatchObject({ result: "new", errors: [], input: { departmentId: "d1", entryDate: "2024-03-01", status: "ACTIVE" } });
    expect(b).toMatchObject({ result: "new", employeeNumber: "4711", input: { employeeNumber: "4711", status: "INACTIVE" } });
  });

  it("meldet Fehler pro Zeile", () => {
    const results = validateImportRows(
      [
        row(2, { lastName: "", entryDate: "31.02.2024" }),
        row(3, { department: "Lager" }),
        row(4, { department: "Versand" }),
        row(5, { status: "Ausgeschieden" }),
        row(6, { exitDate: "01.01.2020" }),
        row(7, { employeeNumber: "A B" }),
      ],
      ctx,
    );
    expect(results.every((r) => r.result === "error" && !r.input)).toBe(true);
    expect(results[0].errors).toEqual(["Eintrittsdatum „31.02.2024“ ist kein gültiges Datum", "Nachname: Pflichtfeld"]);
    expect(results[1].errors[0]).toContain("nicht eindeutig");
    expect(results[2].errors[0]).toContain("nicht gefunden");
    expect(results[3].errors[0]).toContain("Austrittsdatum erforderlich");
    expect(results[4].errors[0]).toContain("Austritt vor Eintritt");
    expect(results[5].errors[0]).toContain("Personalnummer");
  });

  it("erkennt Duplikate in der Datei und in der Datenbank, gibt Namenshinweis und überspringt Leerzeilen", () => {
    const results = validateImportRows(
      [
        row(2, { employeeNumber: "X1" }),
        row(3, { employeeNumber: "x1" }),
        row(4, { employeeNumber: "1000" }),
        row(5, { lastName: "Muster", firstName: "Max" }),
        { rowNumber: 6, values: { employeeNumber: "", lastName: null } },
      ],
      ctx,
    );
    expect(results.map((r) => r.result)).toEqual(["new", "error", "duplicate", "new"]);
    expect(results[1].errors[0]).toContain("Zeile 2");
    expect(results[2].input).toBeUndefined();
    expect(results[3].warnings[0]).toContain("1000");
  });
});
