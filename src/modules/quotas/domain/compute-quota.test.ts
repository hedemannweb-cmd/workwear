import { describe, expect, it } from "vitest";
import { computeQuota, remainingFor, type QuotaInput } from "./compute-quota";

const d = (iso: string) => new Date(`${iso}T10:00:00Z`);

const groups = [
  { id: "g-shirt", name: "T-Shirt", sortOrder: 1, isQuotaRelevant: true },
  { id: "g-pants", name: "Arbeitshose", sortOrder: 2, isQuotaRelevant: true },
  { id: "g-gloves", name: "Handschuhe", sortOrder: 9, isQuotaRelevant: false },
];

function input(overrides: Partial<QuotaInput> = {}): QuotaInput {
  return {
    year: 2026,
    entryDate: "2020-03-01",
    entryRule: "PRORATED",
    profile: { code: "PRODUKTION_STANDARD", name: "Produktion" },
    groups,
    rules: [
      { quotaGroupId: "g-shirt", quantityPerYear: 5 },
      { quotaGroupId: "g-pants", quantityPerYear: 2 },
    ],
    adjustments: [],
    issues: [],
    returnCredits: [],
    reservations: [],
    ...overrides,
  };
}

const issue = (qty: number, date: string, group = "g-shirt", n = 1) => ({
  issueId: `i${n}`,
  issueNumber: `A-2026-${n}`,
  quotaGroupId: group,
  quantity: qty,
  date: d(date),
  label: `Ausgabe A-2026-${n}`,
});

const line = (lines: ReturnType<typeof computeQuota>, id: string) => {
  const l = lines.find((x) => x.quotaGroupId === id);
  if (!l) throw new Error(`Zeile ${id} fehlt`);
  return l;
};

describe("computeQuota", () => {
  it("Teilabruf: 5 Anspruch, 2 + 1 ausgegeben → 2 verfügbar", () => {
    const l = line(computeQuota(input({ issues: [issue(2, "2026-01-15", "g-shirt", 1), issue(1, "2026-05-03", "g-shirt", 2)] })), "g-shirt");
    expect(l).toMatchObject({ base: 5, adjustments: 0, issued: 3, reserved: 0, available: 2, overdrawn: false });
  });

  it("vollständig verbraucht: 2 + 1 + 2 → 0 verfügbar", () => {
    const l = line(
      computeQuota(input({ issues: [issue(2, "2026-01-15", "g-shirt", 1), issue(1, "2026-05-03", "g-shirt", 2), issue(2, "2026-09-18", "g-shirt", 3)] })),
      "g-shirt",
    );
    expect(l.available).toBe(0);
    expect(remainingFor(l)).toBe(0);
  });

  it("individuelle Anpassung erhöht den verfügbaren Anspruch", () => {
    const l = line(
      computeQuota(
        input({
          issues: [issue(1, "2026-02-01", "g-pants")],
          adjustments: [{ id: "a1", quotaGroupId: "g-pants", quantityDelta: 1, date: d("2026-03-01"), reason: "Schweißarbeiten", source: "MANUAL" }],
        }),
      ),
      "g-pants",
    );
    expect(l).toMatchObject({ base: 2, adjustments: 1, issued: 1, available: 2 });
  });

  it("aktive Reservierung reduziert das verfügbare Kontingent", () => {
    const l = line(
      computeQuota(
        input({
          issues: [issue(2, "2026-01-15")],
          reservations: [{ id: "r1", quotaGroupId: "g-shirt", quantity: 1, date: d("2026-04-03"), status: "ORDERED", label: "Reservierung" }],
        }),
      ),
      "g-shirt",
    );
    expect(l).toMatchObject({ base: 5, issued: 2, reserved: 1, available: 2 });
  });

  it("Rückgabe-Gutschrift gibt Kontingent zurück, Gutschrift 0 (WRITE_OFF) nicht", () => {
    const l = line(
      computeQuota(
        input({
          issues: [issue(3, "2026-01-15")],
          returnCredits: [
            { returnId: "ret1", returnNumber: "R-1", quotaGroupId: "g-shirt", credit: 1, date: d("2026-02-01"), label: "Rückgabe" },
            { returnId: "ret2", returnNumber: "R-2", quotaGroupId: "g-shirt", credit: 0, date: d("2026-02-02"), label: "Abschreibung" },
          ],
        }),
      ),
      "g-shirt",
    );
    expect(l).toMatchObject({ issued: 2, available: 3 });
    expect(l.ledger.filter((e) => e.kind === "RETURN_CREDIT")).toHaveLength(1);
  });

  it("Umtausch ist netto neutral (Gutschrift + neue Ausgabe im selben Jahr)", () => {
    const l = line(
      computeQuota(
        input({
          issues: [issue(1, "2026-01-15", "g-pants", 1), issue(1, "2026-01-20", "g-pants", 2)],
          returnCredits: [{ returnId: "ret1", returnNumber: "R-1", quotaGroupId: "g-pants", credit: 1, date: d("2026-01-20"), label: "Umtausch" }],
        }),
      ),
      "g-pants",
    );
    expect(l).toMatchObject({ issued: 1, available: 1 });
  });

  it("markiert Überziehung (z. B. nach Abteilungswechsel), available bleibt 0", () => {
    const l = line(computeQuota(input({ rules: [{ quotaGroupId: "g-shirt", quantityPerYear: 2 }], issues: [issue(3, "2026-01-15")] })), "g-shirt");
    expect(l).toMatchObject({ available: 0, overdrawn: true });
  });

  it("Eintrittsjahr wird anteilig berechnet", () => {
    const l = line(computeQuota(input({ entryDate: "2026-04-15" })), "g-shirt");
    expect(l.base).toBe(4);
    expect(l.baseExplanation).toContain("PRODUKTION_STANDARD");
  });

  it("nicht kontingentrelevante Gruppe ist unbegrenzt", () => {
    const l = line(computeQuota(input({ includeGroupIds: ["g-gloves"], issues: [issue(10, "2026-01-01", "g-gloves")] })), "g-gloves");
    expect(l.available).toBeNull();
    expect(remainingFor(l)).toBe(Number.POSITIVE_INFINITY);
    expect(l.overdrawn).toBe(false);
  });

  it("ohne Profil: Anspruch 0 mit Erklärung", () => {
    const l = line(computeQuota(input({ profile: null, rules: [], includeGroupIds: ["g-shirt"] })), "g-shirt");
    expect(l).toMatchObject({ base: 0, available: 0 });
    expect(l.baseExplanation).toContain("kein Kontingentprofil");
  });

  it("Nachweis ist chronologisch und summiert sich zum verfügbaren Wert", () => {
    const l = line(
      computeQuota(
        input({
          issues: [issue(2, "2026-01-15", "g-shirt", 1)],
          reservations: [{ id: "r1", quotaGroupId: "g-shirt", quantity: 1, date: d("2026-04-03"), status: "PENDING", label: "Reservierung" }],
          adjustments: [{ id: "a1", quotaGroupId: "g-shirt", quantityDelta: 1, date: d("2026-02-01"), reason: "Sonderfall", source: "MANUAL" }],
        }),
      ),
      "g-shirt",
    );
    expect(l.ledger.map((e) => e.kind)).toEqual(["BASE", "ISSUE", "ADJUSTMENT", "RESERVATION"]);
    expect(l.ledger.reduce((s, e) => s + e.effect, 0)).toBe(l.available);
  });

  it("zeigt nur Gruppen mit Regel oder Buchung, sortiert", () => {
    const lines = computeQuota(input());
    expect(lines.map((l) => l.quotaGroupName)).toEqual(["T-Shirt", "Arbeitshose"]);
  });
});
