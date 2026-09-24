import { beforeAll, describe, expect, it } from "vitest";
import { currentYear } from "@/lib/dates";
import { getEmployeeQuota } from "@/modules/quotas/server/quota-service";
import { db } from "@/server/db";
import { seed } from "../../prisma/seed";
import { assertJournalConsistent, resetDb } from "./fixtures";

/** Der Demo-Seed läuft vollständig über die Domänenprozesse – dieser Test hält ihn lauffähig. */
describe("Demo-Seed", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.SEED_ADMIN_EMAIL ??= "admin@example.com";
    process.env.SEED_ADMIN_PASSWORD ??= "Admin-Demo-2026!";
    await seed();
  }, 120_000);

  it("erzeugt das Beispiel aus der Aufgabenstellung (Max Mustermann, 4711)", async () => {
    const max = await db.employee.findUniqueOrThrow({ where: { employeeNumber: "4711" } });
    const quota = await getEmployeeQuota(max.id, currentYear());
    expect(quota.find((q) => q.quotaGroupName === "T-Shirt")).toMatchObject({ base: 5, issued: 2, reserved: 1, available: 2 });
    expect(quota.find((q) => q.quotaGroupName === "Arbeitshose")).toMatchObject({ base: 2, issued: 1, reserved: 0, available: 1 });
  });

  it("enthält die geforderten Szenarien und ein konsistentes Lagerjournal", async () => {
    expect(await db.employee.count()).toBeGreaterThanOrEqual(15);
    expect(await db.order.count({ where: { status: "PARTIALLY_RECEIVED" } })).toBe(1);
    expect(await db.order.count({ where: { status: "CANCELLED" } })).toBe(1);
    expect(await db.employeeReservation.count({ where: { status: "RECEIVED" } })).toBeGreaterThan(0);
    await assertJournalConsistent();
  });

  it("ist idempotent (zweiter Lauf überspringt)", async () => {
    const before = await db.employee.count();
    await seed();
    expect(await db.employee.count()).toBe(before);
  });
});
