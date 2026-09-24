import { describe, expect, it } from "vitest";
import { entitlementForYear } from "./proration";

describe("entitlementForYear – PRORATED (BDR-4)", () => {
  // Tabelle aus KONZEPT.md: Monate = 12 − Eintrittsmonat + 1, kaufmännisch gerundet, min. 1
  const cases: Array<[string, number, number]> = [
    ["2026-01-01", 5, 5], // 12/12
    ["2026-01-31", 5, 5],
    ["2026-04-15", 5, 4], // 5 × 9/12 = 3,75 → 4
    ["2026-07-01", 5, 3], // 5 × 6/12 = 2,5 → 3 (halb aufrunden)
    ["2026-11-01", 5, 1], // 5 × 2/12 = 0,83 → 1
    ["2026-12-31", 5, 1], // 5 × 1/12 = 0,42 → 0 → Mindestanspruch 1
    ["2026-04-15", 2, 2], // 2 × 9/12 = 1,5 → 2
    ["2026-10-01", 2, 1], // 2 × 3/12 = 0,5 → 1
    ["2026-11-01", 1, 1], // 1 × 2/12 = 0,17 → 0 → Mindestanspruch 1
    ["2026-07-01", 1, 1], // 0,5 → 1
    ["2026-06-01", 6, 4], // 6 × 7/12 = 3,5 → 4
  ];
  it.each(cases)("Eintritt %s, Basis %i → %i", (entryDate, base, expected) => {
    expect(entitlementForYear({ base, year: 2026, entryDate, entryRule: "PRORATED" }).quantity).toBe(expected);
  });

  it("Basis 0 bleibt 0 (kein Mindestanspruch)", () => {
    expect(entitlementForYear({ base: 0, year: 2026, entryDate: "2026-12-01", entryRule: "PRORATED" }).quantity).toBe(0);
  });

  it("erklärt die Rechnung nachvollziehbar", () => {
    const r = entitlementForYear({ base: 5, year: 2026, entryDate: "2026-04-15", entryRule: "PRORATED" });
    expect(r.explanation).toContain("9/12 von 5 = 3,75 → 4");
  });
});

describe("entitlementForYear – andere Regeln und Jahre", () => {
  it("FULL im Eintrittsjahr: voller Anspruch", () => {
    expect(entitlementForYear({ base: 5, year: 2026, entryDate: "2026-11-01", entryRule: "FULL" }).quantity).toBe(5);
  });
  it("MANUAL im Eintrittsjahr: 0", () => {
    expect(entitlementForYear({ base: 5, year: 2026, entryDate: "2026-03-01", entryRule: "MANUAL" }).quantity).toBe(0);
  });
  it("Folgejahr nach Eintritt: immer voller Anspruch", () => {
    for (const rule of ["FULL", "PRORATED", "MANUAL"] as const) {
      expect(entitlementForYear({ base: 5, year: 2027, entryDate: "2026-11-01", entryRule: rule }).quantity).toBe(5);
    }
  });
  it("Jahr vor dem Eintritt: kein Anspruch", () => {
    expect(entitlementForYear({ base: 5, year: 2025, entryDate: "2026-02-01", entryRule: "FULL" }).quantity).toBe(0);
  });
});
