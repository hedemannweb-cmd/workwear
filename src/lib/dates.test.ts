import { describe, expect, it } from "vitest";
import { addMonthsIso, startOfDayInAppTz, yearInAppTz } from "./dates";

describe("Zeitzone Europe/Berlin", () => {
  it("Mitternacht im Sommer (CEST, UTC+2) und Winter (CET, UTC+1)", () => {
    expect(startOfDayInAppTz("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfDayInAppTz("2026-01-01").toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
  it("Silvester 23:30 UTC gehört in Berlin bereits zum neuen Jahr", () => {
    expect(yearInAppTz(new Date("2025-12-31T23:30:00Z"))).toBe(2026);
  });
});

describe("addMonthsIso", () => {
  it("rechnet über Jahresgrenzen", () => {
    expect(addMonthsIso("2027-11-01", 24)).toBe("2029-11-01");
    expect(addMonthsIso("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("kürzt auf den Monatsletzten", () => {
    expect(addMonthsIso("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsIso("2028-02-29", 12)).toBe("2029-02-28");
  });
});
