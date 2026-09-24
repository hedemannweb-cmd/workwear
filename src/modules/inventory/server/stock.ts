import "server-only";
import { createId } from "@paralleldrive/cuid2";
import type { MovementReference, MovementType } from "@/generated/prisma/enums";
import { DomainError } from "@/server/errors";
import type { Tx } from "@/server/tx";

/**
 * Einzige Stelle, an der Lagerbestände verändert werden (KONZEPT.md F).
 *
 * Jede Änderung
 *  1. aktualisiert die Inventory-Zeile mit einem bedingten, atomaren UPDATE. Die WHERE-Klausel
 *     enthält die Invariante (neuer physischer Bestand ≥ neuer reservierter Bestand ≥ 0). Parallele
 *     Transaktionen warten auf die Zeilensperre und prüfen die Bedingung danach mit den aktuellen
 *     Werten erneut (READ COMMITTED). Damit kann das letzte Stück nicht zweimal ausgegeben werden.
 *  2. schreibt die zugehörige InventoryMovement mit den Werten nach der Buchung.
 * Die CHECK-Constraints der Tabelle sind das letzte Sicherheitsnetz.
 */
export type StockChange = {
  articleVariantId: string;
  inventoryLocationId: string;
  type: MovementType;
  /** Änderung des physischen Bestands */
  physicalDelta: number;
  /** Änderung des reservierten Bestands */
  reservedDelta?: number;
  referenceType: MovementReference;
  referenceId: string;
  userId: string;
  reason?: string | null;
  transferGroupId?: string;
};

export type StockSnapshot = { physicalQuantity: number; reservedQuantity: number };

export async function applyStockChange(tx: Tx, change: StockChange): Promise<StockSnapshot> {
  const reservedDelta = change.reservedDelta ?? 0;
  if (change.physicalDelta === 0 && reservedDelta === 0) {
    throw new Error("applyStockChange ohne Wirkung aufgerufen");
  }

  await tx.$executeRaw`
    INSERT INTO "Inventory" ("id", "articleVariantId", "inventoryLocationId", "physicalQuantity", "reservedQuantity", "version", "updatedAt")
    VALUES (${createId()}, ${change.articleVariantId}, ${change.inventoryLocationId}, 0, 0, 0, now())
    ON CONFLICT ("articleVariantId", "inventoryLocationId") DO NOTHING`;

  const rows = await tx.$queryRaw<Array<{ physicalQuantity: number; reservedQuantity: number }>>`
    UPDATE "Inventory"
       SET "physicalQuantity" = "physicalQuantity" + ${change.physicalDelta}::int,
           "reservedQuantity" = "reservedQuantity" + ${reservedDelta}::int,
           "version" = "version" + 1,
           "updatedAt" = now()
     WHERE "articleVariantId" = ${change.articleVariantId}
       AND "inventoryLocationId" = ${change.inventoryLocationId}
       AND "reservedQuantity" + ${reservedDelta}::int >= 0
       AND "physicalQuantity" + ${change.physicalDelta}::int >= "reservedQuantity" + ${reservedDelta}::int
    RETURNING "physicalQuantity", "reservedQuantity"`;

  const after = rows[0];
  if (!after) {
    const current = await tx.inventory.findUnique({
      where: {
        articleVariantId_inventoryLocationId: {
          articleVariantId: change.articleVariantId,
          inventoryLocationId: change.inventoryLocationId,
        },
      },
      select: { physicalQuantity: true, reservedQuantity: true },
    });
    const free = current ? current.physicalQuantity - current.reservedQuantity : 0;
    throw new DomainError(
      "STOCK_INSUFFICIENT",
      change.physicalDelta < 0 && reservedDelta === 0
        ? `Nicht genügend Lagerbestand: ${Math.max(0, free)} frei verfügbar, ${-change.physicalDelta} benötigt.`
        : "Die Lagerbuchung ist mit dem aktuellen Bestand nicht möglich.",
      { free, requested: -change.physicalDelta },
    );
  }

  await tx.inventoryMovement.create({
    data: {
      articleVariantId: change.articleVariantId,
      inventoryLocationId: change.inventoryLocationId,
      type: change.type,
      quantityDelta: change.physicalDelta,
      reservedDelta,
      physicalAfter: after.physicalQuantity,
      reservedAfter: after.reservedQuantity,
      referenceType: change.referenceType,
      referenceId: change.referenceId,
      transferGroupId: change.transferGroupId,
      userId: change.userId,
      reason: change.reason ?? null,
    },
  });

  return after;
}

/**
 * Mehrere Änderungen in fester Reihenfolge (Variante, Lagerort) buchen – verhindert Deadlocks,
 * wenn zwei Transaktionen dieselben Zeilen in unterschiedlicher Reihenfolge anfassen würden.
 */
export async function applyStockChanges(tx: Tx, changes: StockChange[]): Promise<void> {
  const sorted = [...changes].sort(
    (a, b) =>
      a.articleVariantId.localeCompare(b.articleVariantId) || a.inventoryLocationId.localeCompare(b.inventoryLocationId),
  );
  for (const c of sorted) await applyStockChange(tx, c);
}

export async function getDefaultLocationId(tx: Tx): Promise<string> {
  const loc = await tx.inventoryLocation.findFirst({ where: { isDefault: true, active: true }, select: { id: true } });
  if (!loc) throw new DomainError("INVALID_STATE", "Es ist kein Standard-Lagerort eingerichtet.");
  return loc.id;
}
