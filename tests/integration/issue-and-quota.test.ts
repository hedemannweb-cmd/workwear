import { beforeEach, describe, expect, it } from "vitest";
import { currentYear, toIsoDateInAppTz } from "@/lib/dates";
import { cancelIssue, issueClothing } from "@/modules/issues/server/issue-clothing";
import { adjustQuota } from "@/modules/quotas/server/adjust-quota";
import { getEmployeeQuota } from "@/modules/quotas/server/quota-service";
import { cancelReservation, reserveClothing } from "@/modules/reservations/server/reservations";
import { changeDepartment } from "@/modules/employees/server/change-department";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import {
  assertJournalConsistent,
  inventoryOf,
  makeActor,
  makeEmployee,
  makeWorld,
  resetDb,
  rid,
  stock,
  type World,
} from "./fixtures";

const YEAR = currentYear();
let world: World;

beforeEach(async () => {
  await resetDb();
  world = await makeWorld();
});

async function quotaLine(employeeId: string, groupId: string, year = YEAR) {
  const lines = await getEmployeeQuota(employeeId, year, { includeGroupIds: [groupId] });
  return lines.find((l) => l.quotaGroupId === groupId)!;
}

function expectDomainError(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

describe("Kleidung ausgeben", () => {
  it("reduziert Lagerbestand und Kontingent, schreibt Bewegung und Audit", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtXL, 10);

    const res = await issueClothing(world.admin, {
      employeeId: emp.id,
      clientRequestId: rid(),
      items: [{ articleVariantId: world.variants.shirtXL, quantity: 2 }],
    });

    expect(res.issueNumber).toMatch(new RegExp(`^A-${YEAR}-\\d{6}$`));
    expect(await inventoryOf(world, world.variants.shirtXL)).toEqual({ physical: 8, reserved: 0 });
    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ base: 5, issued: 2, available: 3 });

    const item = await db.clothingIssueItem.findFirstOrThrow({ where: { issueId: res.issueId }, include: { issue: true } });
    expect(item).toMatchObject({ quantity: 2, quotaYear: YEAR, inventoryLocationId: world.location.id });
    expect(item.unitCost?.toString()).toBe("7.5");
    expect(item.issue).toMatchObject({ issuedById: world.admin.userId, departmentIdSnapshot: world.departments.prod.id });

    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { referenceId: res.issueId } });
    expect(movement).toMatchObject({ type: "ISSUE", quantityDelta: -2, physicalAfter: 8, userId: world.admin.userId });
    expect(await db.auditLog.count({ where: { action: "CLOTHING_ISSUED", entityId: res.issueId } })).toBe(1);
    await assertJournalConsistent();
  });

  it("Teilabrufe bis zum vollständigen Verbrauch, danach wird Überschreitung verhindert", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtL, 20);
    for (const qty of [2, 1, 2]) {
      await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtL, quantity: qty }] });
    }
    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ issued: 5, available: 0 });

    await expectDomainError(
      issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtL, quantity: 1 }] }),
      "QUOTA_EXCEEDED",
    );
    // atomar: keine Teilbuchung
    expect(await inventoryOf(world, world.variants.shirtL)).toEqual({ physical: 15, reserved: 0 });
  });

  it("verhindert Ausgabe ohne ausreichenden Lagerbestand – Kontingent bleibt unverändert", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.pants52, 1);
    await expectDomainError(
      issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants52, quantity: 2 }] }),
      "STOCK_INSUFFICIENT",
    );
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ issued: 0, available: 2 });
    expect(await db.clothingIssue.count()).toBe(0);
  });

  it("lehnt inaktive Mitarbeiter ab", async () => {
    const emp = await makeEmployee(world.departments.prod.id, { status: "INACTIVE" });
    await stock(world, world.variants.shirtM, 5);
    await expectDomainError(
      issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtM, quantity: 1 }] }),
      "EMPLOYEE_INACTIVE",
    );
  });

  it("Idempotenz: dieselbe clientRequestId bucht nur einmal", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtM, 5);
    const requestId = rid();
    const input = { employeeId: emp.id, clientRequestId: requestId, items: [{ articleVariantId: world.variants.shirtM, quantity: 1 }] };
    const [a, b] = await Promise.all([issueClothing(world.admin, input), issueClothing(world.admin, input)]);
    expect(a.issueId).toBe(b.issueId);
    expect(await inventoryOf(world, world.variants.shirtM)).toEqual({ physical: 4, reserved: 0 });
  });

  it("nicht kontingentrelevante Artikel werden ohne Kontingent ausgegeben", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.gloves, 50);
    await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.gloves, quantity: 20 }] });
    const line = await quotaLine(emp.id, world.groups.free.id);
    expect(line.available).toBeNull();
  });
});

describe("Admin-Sonderfreigabe (BDR-6)", () => {
  it("legt bei Überschreitung automatisch eine Anpassung an und bucht die Ausgabe", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.pants54, 10);
    await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants54, quantity: 2 }] });

    const res = await issueClothing(world.admin, {
      employeeId: emp.id,
      clientRequestId: rid(),
      items: [{ articleVariantId: world.variants.pants54, quantity: 1 }],
      override: { reason: "Hose bei Unfall beschädigt" },
    });

    const adj = await db.employeeQuotaAdjustment.findFirstOrThrow({ where: { relatedIssueId: res.issueId } });
    expect(adj).toMatchObject({ quantityDelta: 1, source: "OVERRIDE", reason: "Hose bei Unfall beschädigt" });
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ base: 2, adjustments: 1, issued: 3, available: 0, overdrawn: false });
    expect(await db.auditLog.count({ where: { action: "QUOTA_OVERRIDE" } })).toBe(1);
  });

  it("RESPONSIBLE darf keine Sonderfreigabe erteilen", async () => {
    const responsible = await makeActor("RESPONSIBLE");
    const emp = await makeEmployee(world.departments.prod.id);
    await expectDomainError(
      issueClothing(responsible, {
        employeeId: emp.id,
        clientRequestId: rid(),
        items: [{ articleVariantId: world.variants.pants54, quantity: 1 }],
        override: { reason: "Versuch ohne Recht" },
      }),
      "FORBIDDEN",
    );
  });

  it("Storno einer Ausgabe mit Sonderfreigabe hebt die Freigabe wieder auf", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.pants54, 10);
    await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants54, quantity: 2 }] });
    const res = await issueClothing(world.admin, {
      employeeId: emp.id,
      clientRequestId: rid(),
      items: [{ articleVariantId: world.variants.pants54, quantity: 1 }],
      override: { reason: "Sonderfall Unfall" },
    });
    await cancelIssue(world.admin, { issueId: res.issueId, reason: "Falsch gebucht" });
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ adjustments: 0, issued: 2, available: 0 });
    expect(await inventoryOf(world, world.variants.pants54)).toEqual({ physical: 8, reserved: 0 });
    await assertJournalConsistent();
  });
});

describe("Individuelle Anpassung", () => {
  it("erhöht das Kontingent, verlangt Begründung und protokolliert vorher/nachher", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await adjustQuota(world.admin, { employeeId: emp.id, quotaGroupId: world.groups.pants.id, year: YEAR, quantityDelta: 2, reason: "Schweißarbeiten" });
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ base: 2, adjustments: 2, available: 4 });

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "QUOTA_ADJUSTED" } });
    expect(log.reason).toBe("Schweißarbeiten");
    expect(log.oldValue).toMatchObject({ available: 2 });
    expect(log.newValue).toMatchObject({ available: 4, quantityDelta: 2 });

    await expect(
      adjustQuota(world.admin, { employeeId: emp.id, quotaGroupId: world.groups.pants.id, year: YEAR, quantityDelta: 1, reason: "" }),
    ).rejects.toThrow();
  });

  it("Kürzung unter bereits gebundene Menge ist nicht möglich", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.pants52, 5);
    await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants52, quantity: 2 }] });
    await expectDomainError(
      adjustQuota(world.admin, { employeeId: emp.id, quotaGroupId: world.groups.pants.id, year: YEAR, quantityDelta: -1, reason: "Kürzung Test" }),
      "QUOTA_EXCEEDED",
    );
  });

  it("RESPONSIBLE darf keine Anpassung vornehmen", async () => {
    const responsible = await makeActor("RESPONSIBLE");
    const emp = await makeEmployee(world.departments.prod.id);
    await expectDomainError(
      adjustQuota(responsible, { employeeId: emp.id, quotaGroupId: world.groups.pants.id, year: YEAR, quantityDelta: 1, reason: "nicht erlaubt" }),
      "FORBIDDEN",
    );
  });
});

describe("Reservierung", () => {
  it("reduziert das verfügbare Kontingent; Stornierung gibt es wieder frei", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const { reservationIds } = await reserveClothing(world.admin, {
      employeeId: emp.id,
      clientRequestId: rid(),
      items: [{ articleVariantId: world.variants.shirtXL, quantity: 2 }],
    });
    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ reserved: 2, available: 3 });

    await cancelReservation(world.admin, { reservationId: reservationIds[0]!, reason: "Mitarbeiter verzichtet" });
    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ reserved: 0, available: 5 });
  });

  it("verhindert Reservierung über das Kontingent hinaus", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await expectDomainError(
      reserveClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants52, quantity: 3 }] }),
      "QUOTA_EXCEEDED",
    );
  });
});

describe("Nebenläufigkeit", () => {
  it("gleichzeitige Ausgabe durch zwei Benutzer: nur eine von zwei Hosen wird genehmigt", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.pants54, 10);
    // 1 Hose ist bereits ausgegeben → noch 1 verfügbar
    await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants54, quantity: 1 }] });

    const userA = await makeActor("RESPONSIBLE");
    const userB = await makeActor("RESPONSIBLE");
    const results = await Promise.allSettled([
      issueClothing(userA, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants54, quantity: 1 }] }),
      issueClothing(userB, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants54, quantity: 1 }] }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DomainError);
    expect(rejected.reason.code).toBe("QUOTA_EXCEEDED");
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ issued: 2, available: 0 });
    expect(await inventoryOf(world, world.variants.pants54)).toEqual({ physical: 8, reserved: 0 });
  });

  it("gleichzeitige Reservierung durch zwei Benutzer: Kontingent wird nicht überbucht", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reserveClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants52, quantity: 1 }] }),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ reserved: 2, available: 0 });
  });

  it("letztes Lagerstück für zwei Mitarbeiter gleichzeitig: nur eine Ausgabe gelingt", async () => {
    const empA = await makeEmployee(world.departments.prod.id);
    const empB = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtM, 1);
    const results = await Promise.allSettled([
      issueClothing(world.admin, { employeeId: empA.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtM, quantity: 1 }] }),
      issueClothing(world.admin, { employeeId: empB.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtM, quantity: 1 }] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("STOCK_INSUFFICIENT");
    expect(await inventoryOf(world, world.variants.shirtM)).toEqual({ physical: 0, reserved: 0 });
    await assertJournalConsistent();
  });
});

describe("Bestand kann nicht negativ werden", () => {
  it("auch ein direktes SQL-Update scheitert am CHECK-Constraint", async () => {
    await stock(world, world.variants.shirtM, 1);
    await expect(
      db.$executeRaw`UPDATE "Inventory" SET "physicalQuantity" = -1 WHERE "articleVariantId" = ${world.variants.shirtM}`,
    ).rejects.toThrow(/inventory_physical_nonnegative|check constraint/i);
  });

  it("Lagerbewegungen und Audit Log sind unveränderlich", async () => {
    await stock(world, world.variants.shirtM, 1);
    await expect(db.$executeRaw`DELETE FROM "InventoryMovement"`).rejects.toThrow(/unveränderlich/);
    await expect(db.$executeRaw`UPDATE "AuditLog" SET "reason" = 'x'`).rejects.toThrow(/unveränderlich/);
  });
});

describe("Autorisierung mit Abteilungs-Scope", () => {
  it("eingeschränkter RESPONSIBLE kann Mitarbeiter fremder Abteilungen nicht buchen", async () => {
    const responsible = await makeActor("RESPONSIBLE", [world.departments.lager.id]);
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtM, 5);
    await expectDomainError(
      issueClothing(responsible, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtM, quantity: 1 }] }),
      "NOT_FOUND",
    );
  });
});

describe("Abteilungswechsel und Jahreswechsel", () => {
  it("Wechsel ändert den Anspruch nach Stichtagsprofil, historische Ausgaben behalten ihre Abteilung", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtM, 10);
    const res = await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtM, quantity: 2 }] });

    await changeDepartment(world.admin, {
      employeeId: emp.id,
      departmentId: world.departments.lager.id,
      validFrom: toIsoDateInAppTz(new Date()),
      reason: "Versetzung ins Lager",
    });

    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ base: 6, issued: 2, available: 4 });
    const issue = await db.clothingIssue.findUniqueOrThrow({ where: { id: res.issueId } });
    expect(issue.departmentIdSnapshot).toBe(world.departments.prod.id);
    expect(await db.employeeDepartmentHistory.count({ where: { employeeId: emp.id } })).toBe(2);
  });

  it("Jahreswechsel: neues Jahr startet mit vollem Anspruch, Vorjahr bleibt unverändert", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await stock(world, world.variants.shirtM, 10);
    await issueClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.shirtM, quantity: 3 }] });

    expect(await quotaLine(emp.id, world.groups.shirt.id, YEAR)).toMatchObject({ issued: 3, available: 2 });
    expect(await quotaLine(emp.id, world.groups.shirt.id, YEAR + 1)).toMatchObject({ base: 5, issued: 0, available: 5 });
  });

  it("neue Regel für ein künftiges Jahr verändert das laufende Jahr nicht", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    await db.quotaRule.create({
      data: { quotaProfileId: world.profiles.prod.id, quotaGroupId: world.groups.shirt.id, validFromYear: YEAR + 1, quantityPerYear: 7 },
    });
    expect((await quotaLine(emp.id, world.groups.shirt.id, YEAR)).base).toBe(5);
    expect((await quotaLine(emp.id, world.groups.shirt.id, YEAR + 1)).base).toBe(7);
  });

  it("Eintritt im laufenden Jahr: anteiliger Anspruch (PRORATED)", async () => {
    const emp = await makeEmployee(world.departments.prod.id, { entryDate: `${YEAR}-07-01` });
    // 5 × 6/12 = 2,5 → 3
    expect((await quotaLine(emp.id, world.groups.shirt.id)).base).toBe(3);
  });
});
