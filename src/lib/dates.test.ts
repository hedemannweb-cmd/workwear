import { describe, expect, it } from "vitest";
import { startOfDayInAppTz, yearInAppTz } from "./dates";

describe("Zeitzone Europe/Berlin", () => {
  it("Mitternacht im Sommer (CEST, UTC+2) und Winter (CET, UTC+1)", () => {
    expect(startOfDayInAppTz("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfDayInAppTz("2026-01-01").toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
  it("Silvester 23:30 UTC gehört in Berlin bereits zum neuen Jahr", () => {
    expect(yearInAppTz(new Date("2025-12-31T23:30:00Z"))).toBe(2026);
  });
});
