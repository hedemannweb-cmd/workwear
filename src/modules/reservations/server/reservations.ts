import "server-only";
import { z } from "zod";
import { currentYear } from "@/lib/dates";
import { assertEmployeeActive } from "@/modules/issues/server/issue-clothing";
import { applyStockChange } from "@/modules/inventory/server/stock";
import { assertQuotaAvailable } from "@/modules/quotas/server/quota-service";
import { type Actor, assertCan, assertEmployeeInScope } from "@/server/actor";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, invalidState, notFound } from "@/server/errors";
import { lockQuotaYears, runInTransaction } from "@/server/tx";
import { optionalReason } from "@/server/reason";

export const reserveClothingSchema = z.object({
  employeeId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  items: z
    .array(z.object({ articleVariantId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1, "Mindestens eine Position angeben.")
    .max(30),
  notes: z.string().trim().max(500).optional(),
});

export type ReserveClothingInput = z.input<typeof reserveClothingSchema>;

/**
 * Nicht vorrätige Kleidung für einen Mitarbeiter bestellen (KONZEPT.md G.2).
 * Legt je Position eine Reservierung (PENDING) an und belegt damit sofort das Kontingent.
 * Die Beschaffung läuft danach über den Bedarf → Bestellung → Wareneingang.
 */
export async function reserveClothing(actor: Actor, rawInput: ReserveClothingInput): Promise<{ reservationIds: string[] }> {
  assertCan(actor, "reservation:create");
  const input = reserveClothingSchema.parse(rawInput);

  const already = await db.employeeReservation.findMany({
    where: { clientRequestId: { startsWith: `${input.clientRequestId}:` } },
    select: { id: true },
  });
  if (already.length) return { reservationIds: already.map((r) => r.id) };

  try {
    return await runInTransaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId } });
      if (!employee) throw notFound("Der Mitarbeiter");
      assertEmployeeInScope(actor, employee);
      assertEmployeeActive(employee);

      const variants = await tx.articleVariant.findMany({
        where: { id: { in: input.items.map((i) => i.articleVariantId) } },
        select: {
          id: true,
          active: true,
          variantSku: true,
          article: { select: { name: true, active: true, quotaGroupId: true, quotaGroup: { select: { isQuotaRelevant: true } } } },
        },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));
      for (const item of input.items) {
        const v = byId.get(item.articleVariantId);
        if (!v) throw notFound("Die Artikelvariante");
        if (!v.active || !v.article.active) {
          throw new DomainError("ARTICLE_INACTIVE", `Der Artikel „${v.article.name}“ (${v.variantSku}) ist nicht mehr aktiv.`);
        }
      }

      const year = currentYear();
      await lockQuotaYears(tx, [{ employeeId: employee.id, year }]);

      const demand = new Map<string, number>();
      for (const item of input.items) {
        const v = byId.get(item.articleVariantId)!;
        if (!v.article.quotaGroup.isQuotaRelevant) continue;
        demand.set(v.article.quotaGroupId, (demand.get(v.article.quotaGroupId) ?? 0) + item.quantity);
      }
      for (const [quotaGroupId, quantity] of demand) {
        await assertQuotaAvailable(tx, { employeeId: employee.id, year, quotaGroupId, quantity });
      }

      const ids: string[] = [];
      for (const [index, item] of input.items.entries()) {
        const v = byId.get(item.articleVariantId)!;
        const r = await tx.employeeReservation.create({
          data: {
            employeeId: employee.id,
            articleVariantId: item.articleVariantId,
            quotaGroupId: v.article.quotaGroupId,
            quotaYear: year,
            quantity: item.quantity,
            clientRequestId: `${input.clientRequestId}:${index}`,
            notes: input.notes || null,
            createdById: actor.userId,
          },
        });
        ids.push(r.id);
        await audit(tx, {
          actorId: actor.userId,
          action: "RESERVATION_CREATED",
          entityType: "EmployeeReservation",
          entityId: r.id,
          newValue: { employeeNumber: employee.employeeNumber, variantSku: v.variantSku, quantity: item.quantity, quotaYear: year },
        });
      }
      return { reservationIds: ids };
    });
  } catch (e) {
    const again = await db.employeeReservation.findMany({
      where: { clientRequestId: { startsWith: `${input.clientRequestId}:` } },
      select: { id: true },
    });
    if (again.length) return { reservationIds: again.map((r) => r.id) };
    throw e;
  }
}

export const cancelReservationSchema = z.object({
  reservationId: z.string().min(1),
  reason: optionalReason("Reservierung storniert"),
});

/**
 * Reservierung stornieren (KONZEPT.md G.5): Kontingent wird frei.
 * - Bereits reserviert eingelagerte Ware wird freigegeben (Lager: reserviert −n).
 * - Hängt die Reservierung an einer Bestellung, bleibt die bestellte Menge bestehen und wird Lagerware.
 */
export async function cancelReservation(
  actor: Actor,
  rawInput: z.input<typeof cancelReservationSchema>,
): Promise<{ stillOrdered: boolean }> {
  assertCan(actor, "reservation:cancel");
  const input = cancelReservationSchema.parse(rawInput);

  return runInTransaction(async (tx) => {
    const r = await tx.employeeReservation.findUnique({
      where: { id: input.reservationId },
      include: { employee: true },
    });
    if (!r) throw notFound("Die Reservierung");
    assertEmployeeInScope(actor, r.employee);

    await lockQuotaYears(tx, [{ employeeId: r.employeeId, year: r.quotaYear }]);
    const fresh = await tx.employeeReservation.findUniqueOrThrow({ where: { id: r.id } });
    if (fresh.status === "CANCELLED") throw invalidState("Die Reservierung ist bereits storniert.");
    if (fresh.status === "ISSUED") throw invalidState("Die Ware wurde bereits ausgegeben. Bitte stattdessen eine Rückgabe erfassen.");

    if (fresh.status === "RECEIVED" && fresh.inventoryLocationId) {
      await applyStockChange(tx, {
        articleVariantId: fresh.articleVariantId,
        inventoryLocationId: fresh.inventoryLocationId,
        type: "UNRESERVE",
        physicalDelta: 0,
        reservedDelta: -fresh.quantity,
        referenceType: "RESERVATION",
        referenceId: fresh.id,
        userId: actor.userId,
        reason: input.reason,
      });
    }

    await tx.employeeReservation.update({
      where: { id: fresh.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason },
    });

    await audit(tx, {
      actorId: actor.userId,
      action: "RESERVATION_CANCELLED",
      entityType: "EmployeeReservation",
      entityId: fresh.id,
      oldValue: { status: fresh.status },
      newValue: { status: "CANCELLED" },
      reason: input.reason,
    });

    return { stillOrdered: fresh.status === "ORDERED" };
  });
}
