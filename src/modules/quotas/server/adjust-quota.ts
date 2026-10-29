import "server-only";
import { z } from "zod";
import { type Actor, assertCan, assertEmployeeInScope } from "@/server/actor";
import { audit } from "@/server/audit";
import { DomainError, notFound } from "@/server/errors";
import { lockQuotaYears, runInTransaction } from "@/server/tx";
import { getEmployeeQuota } from "./quota-service";
import { optionalReason } from "@/server/reason";

export const adjustQuotaSchema = z.object({
  employeeId: z.string().min(1),
  quotaGroupId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  quantityDelta: z
    .number()
    .int()
    .min(-50)
    .max(50)
    .refine((v) => v !== 0, "Die Anpassung darf nicht 0 sein."),
  reason: optionalReason("Manuelle Anpassung"),
});

/**
 * Individuelle Kontingentanpassung (KONZEPT.md D.4). Keine Änderung ohne Begründung;
 * Audit enthält den verfügbaren Wert vorher und nachher.
 * Eine Kürzung darf das verfügbare Kontingent nicht unter die bereits gebundene Menge drücken.
 */
export async function adjustQuota(actor: Actor, rawInput: z.input<typeof adjustQuotaSchema>) {
  assertCan(actor, "quota:adjust");
  const input = adjustQuotaSchema.parse(rawInput);

  return runInTransaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw notFound("Der Mitarbeiter");
    assertEmployeeInScope(actor, employee);
    const group = await tx.quotaGroup.findUnique({ where: { id: input.quotaGroupId } });
    if (!group) throw notFound("Die Kontingentgruppe");
    if (!group.isQuotaRelevant) throw new DomainError("VALIDATION", `Für „${group.name}“ gibt es kein Kontingent.`);

    await lockQuotaYears(tx, [{ employeeId: employee.id, year: input.year }]);
    const before = (await getEmployeeQuota(employee.id, input.year, { tx, includeGroupIds: [group.id] })).find(
      (l) => l.quotaGroupId === group.id,
    )!;

    if (input.quantityDelta < 0 && (before.available ?? 0) + input.quantityDelta < 0) {
      throw new DomainError(
        "QUOTA_EXCEEDED",
        `Die Kürzung um ${-input.quantityDelta} ist nicht möglich: nur ${before.available ?? 0} Stück sind noch nicht ausgegeben oder reserviert.`,
      );
    }

    const adjustment = await tx.employeeQuotaAdjustment.create({
      data: {
        employeeId: employee.id,
        quotaGroupId: group.id,
        year: input.year,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        source: "MANUAL",
        createdById: actor.userId,
      },
    });

    await audit(tx, {
      actorId: actor.userId,
      action: "QUOTA_ADJUSTED",
      entityType: "Employee",
      entityId: employee.id,
      oldValue: { quotaGroup: group.name, year: input.year, entitlement: before.base + before.adjustments, available: before.available },
      newValue: {
        quotaGroup: group.name,
        year: input.year,
        quantityDelta: input.quantityDelta,
        entitlement: before.base + before.adjustments + input.quantityDelta,
        available: Math.max(0, (before.available ?? 0) + input.quantityDelta),
        adjustmentId: adjustment.id,
      },
      reason: input.reason,
    });

    return { adjustmentId: adjustment.id };
  });
}
