import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { type Actor, assertCan } from "@/server/actor";
import { audit } from "@/server/audit";
import { DomainError, notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";
import { applyStockChange, applyStockChanges } from "./stock";

const reason = z.string().trim().min(5, "Bitte eine Begründung (mind. 5 Zeichen) angeben.").max(500);

export const adjustInventorySchema = z.discriminatedUnion("mode", [
  /** Korrektur um eine Differenz (z. B. Bruch, Fund) */
  z.object({
    mode: z.literal("delta"),
    articleVariantId: z.string().min(1),
    inventoryLocationId: z.string().min(1),
    quantityDelta: z
      .number()
      .int()
      .min(-9999)
      .max(9999)
      .refine((v) => v !== 0, "Die Korrektur darf nicht 0 sein."),
    reason,
  }),
  /** Zählung: gezählter Bestand wird gesetzt, die Differenz als INVENTORY_COUNT gebucht */
  z.object({
    mode: z.literal("count"),
    articleVariantId: z.string().min(1),
    inventoryLocationId: z.string().min(1),
    countedQuantity: z.number().int().min(0).max(99999),
    reason,
  }),
]);

/**
 * Lagerkorrektur (KONZEPT.md F.2/F.3). Nur MANAGER/ADMIN, immer mit Begründung.
 * Ein negativer Bestand ist ausgeschlossen; reservierte Ware kann nicht wegkorrigiert werden.
 */
export async function adjustInventory(actor: Actor, rawInput: z.input<typeof adjustInventorySchema>) {
  assertCan(actor, "inventory:adjust");
  const input = adjustInventorySchema.parse(rawInput);

  return runInTransaction(async (tx) => {
    const variant = await tx.articleVariant.findUnique({ where: { id: input.articleVariantId }, select: { variantSku: true } });
    if (!variant) throw notFound("Die Artikelvariante");
    const location = await tx.inventoryLocation.findUnique({ where: { id: input.inventoryLocationId } });
    if (!location) throw notFound("Der Lagerort");

    const referenceId = createId();
    let delta: number;
    if (input.mode === "delta") {
      delta = input.quantityDelta;
    } else {
      // Zeile sperren, damit der Zählwert gegen den aktuellen Stand verglichen wird
      const rows = await tx.$queryRaw<Array<{ physicalQuantity: number; reservedQuantity: number }>>`
        SELECT "physicalQuantity", "reservedQuantity" FROM "Inventory"
         WHERE "articleVariantId" = ${input.articleVariantId} AND "inventoryLocationId" = ${input.inventoryLocationId}
         FOR UPDATE`;
      const current = rows[0]?.physicalQuantity ?? 0;
      const reserved = rows[0]?.reservedQuantity ?? 0;
      if (input.countedQuantity < reserved) {
        throw new DomainError(
          "STOCK_INSUFFICIENT",
          `Gezählt wurden ${input.countedQuantity}, aber ${reserved} Stück sind für Mitarbeiter reserviert. Bitte zuerst die Reservierungen prüfen.`,
        );
      }
      delta = input.countedQuantity - current;
      if (delta === 0) {
        await audit(tx, {
          actorId: actor.userId,
          action: "INVENTORY_ADJUSTED",
          entityType: "Inventory",
          entityId: `${input.articleVariantId}:${input.inventoryLocationId}`,
          oldValue: { physicalQuantity: current },
          newValue: { physicalQuantity: current, counted: true, variantSku: variant.variantSku },
          reason: input.reason,
        });
        return { delta: 0 };
      }
    }

    const after = await applyStockChange(tx, {
      articleVariantId: input.articleVariantId,
      inventoryLocationId: input.inventoryLocationId,
      type: input.mode === "count" ? "INVENTORY_COUNT" : "ADJUSTMENT",
      physicalDelta: delta,
      referenceType: "INVENTORY_ADJUSTMENT",
      referenceId,
      userId: actor.userId,
      reason: input.reason,
    });

    await audit(tx, {
      actorId: actor.userId,
      action: "INVENTORY_ADJUSTED",
      entityType: "Inventory",
      entityId: `${input.articleVariantId}:${input.inventoryLocationId}`,
      oldValue: { physicalQuantity: after.physicalQuantity - delta },
      newValue: { physicalQuantity: after.physicalQuantity, delta, variantSku: variant.variantSku, location: location.code },
      reason: input.reason,
    });
    return { delta };
  });
}

export const transferInventorySchema = z.object({
  articleVariantId: z.string().min(1),
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  quantity: z.number().int().min(1).max(99999),
  reason,
});

/** Umlagerung zwischen Lagerorten: zwei Bewegungen mit gemeinsamer transferGroupId. */
export async function transferInventory(actor: Actor, rawInput: z.input<typeof transferInventorySchema>) {
  assertCan(actor, "inventory:adjust");
  const input = transferInventorySchema.parse(rawInput);
  if (input.fromLocationId === input.toLocationId) throw new DomainError("VALIDATION", "Quelle und Ziel müssen verschieden sein.");
  const transferGroupId = createId();
  await runInTransaction(async (tx) => {
    await applyStockChanges(tx, [
      { articleVariantId: input.articleVariantId, inventoryLocationId: input.fromLocationId, type: "TRANSFER_OUT", physicalDelta: -input.quantity, referenceType: "TRANSFER", referenceId: transferGroupId, transferGroupId, userId: actor.userId, reason: input.reason },
      { articleVariantId: input.articleVariantId, inventoryLocationId: input.toLocationId, type: "TRANSFER_IN", physicalDelta: input.quantity, referenceType: "TRANSFER", referenceId: transferGroupId, transferGroupId, userId: actor.userId, reason: input.reason },
    ]);
    await audit(tx, {
      actorId: actor.userId,
      action: "INVENTORY_ADJUSTED",
      entityType: "InventoryTransfer",
      entityId: transferGroupId,
      newValue: input,
      reason: input.reason,
    });
  });
}
