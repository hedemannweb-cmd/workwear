import "server-only";
import { z } from "zod";
import { applyStockChange, getDefaultLocationId } from "@/modules/inventory/server/stock";
import { assertEmployeeActive } from "@/modules/issues/server/issue-clothing";
import { deriveReceiptStatus } from "@/modules/orders/server/orders";
import { preferredUnitCosts } from "@/modules/articles/server/pricing";
import { type Actor, assertCan } from "@/server/actor";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, invalidState, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import { lockOrder, runInTransaction, type Tx } from "@/server/tx";

export const receiveGoodsSchema = z.object({
  orderId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  deliveryNoteNumber: z.string().trim().max(100).optional(),
  inventoryLocationId: z.string().min(1).optional(),
  items: z
    .array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(0).max(99999) }))
    .min(1),
  /** Reservierungen, deren Ware direkt beim Wareneingang ausgegeben wird (sonst: reserviert einlagern) */
  directIssueReservationIds: z.array(z.string().min(1)).default([]),
  /** Überlieferung ausdrücklich bestätigt (E15) */
  allowOverDelivery: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});

export type ReceiveGoodsResult = {
  receiptId: string;
  receiptNumber: string;
  reservedForEmployees: number;
  issuedDirectly: number;
  toFreeStock: number;
};

/**
 * Wareneingang zu einer Bestellung (KONZEPT.md G.3), inkl. Teillieferungen.
 *  1. Bestellung sperren, offene Mengen prüfen.
 *  2. Gelieferte Menge je Position FIFO (nach Reservierungsdatum) den ORDERED-Reservierungen zuteilen.
 *     Teilweise gedeckte Reservierungen werden gesplittet (Rest bleibt ORDERED).
 *  3. Zugeteilte Ware: reserviert einlagern (RESERVE) oder direkt ausgeben (ISSUE).
 *  4. Rest wird freie Lagerware. Bestellstatus wird aus den Positionen abgeleitet.
 */
export async function receiveGoods(actor: Actor, rawInput: z.input<typeof receiveGoodsSchema>): Promise<ReceiveGoodsResult> {
  assertCan(actor, "goodsReceipt:create");
  const input = receiveGoodsSchema.parse(rawInput);

  const existing = await db.goodsReceipt.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (existing) {
    return { receiptId: existing.id, receiptNumber: existing.receiptNumber, reservedForEmployees: 0, issuedDirectly: 0, toFreeStock: 0 };
  }

  return runInTransaction((tx) => receiveInTx(tx, actor, input));
}

async function receiveInTx(tx: Tx, actor: Actor, input: z.output<typeof receiveGoodsSchema>): Promise<ReceiveGoodsResult> {
  await lockOrder(tx, input.orderId);
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { items: { include: { articleVariant: { select: { variantSku: true, articleId: true } } } } },
  });
  if (!order) throw notFound("Die Bestellung");
  if (!["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(order.status)) {
    throw invalidState("Für diese Bestellung kann kein Wareneingang gebucht werden (Status passt nicht).");
  }

  const lines = input.items.filter((i) => i.quantity > 0);
  if (lines.length === 0) throw new DomainError("VALIDATION", "Bitte mindestens eine gelieferte Menge angeben.");

  const itemById = new Map(order.items.map((i) => [i.id, i]));
  for (const line of lines) {
    const item = itemById.get(line.orderItemId);
    if (!item) throw notFound("Die Bestellposition");
    const open = item.quantityOrdered - item.quantityReceived;
    if (line.quantity > open && !input.allowOverDelivery) {
      throw new DomainError(
        "VALIDATION",
        `Für ${item.articleVariant.variantSku} sind nur noch ${Math.max(0, open)} Stück offen, geliefert werden ${line.quantity}. Überlieferung bitte ausdrücklich bestätigen.`,
      );
    }
  }

  const locationId = input.inventoryLocationId ?? (await getDefaultLocationId(tx));
  const receiptNumber = await nextDocumentNumber(tx, "receipt");
  const receipt = await tx.goodsReceipt.create({
    data: {
      receiptNumber,
      orderId: order.id,
      supplierId: order.supplierId,
      receivedById: actor.userId,
      deliveryNoteNumber: input.deliveryNoteNumber || null,
      clientRequestId: input.clientRequestId,
      notes: input.notes || null,
      items: {
        create: lines.map((l) => ({
          orderItemId: l.orderItemId,
          articleVariantId: itemById.get(l.orderItemId)!.articleVariantId,
          inventoryLocationId: locationId,
          quantity: l.quantity,
        })),
      },
    },
  });

  const directIssue = new Set(input.directIssueReservationIds);
  const unitCosts = await preferredUnitCosts(tx, [...new Set(order.items.map((i) => i.articleVariant.articleId))]);
  let reservedForEmployees = 0;
  let issuedDirectly = 0;
  let toFreeStock = 0;
  const allocations: Array<{ reservationId: string; quantity: number; direct: boolean }> = [];

  // Positionen in fester Reihenfolge verarbeiten (Sperrreihenfolge der Lagerzeilen)
  const sortedLines = [...lines].sort((a, b) =>
    itemById.get(a.orderItemId)!.articleVariantId.localeCompare(itemById.get(b.orderItemId)!.articleVariantId),
  );

  for (const line of sortedLines) {
    const item = itemById.get(line.orderItemId)!;

    await applyStockChange(tx, {
      articleVariantId: item.articleVariantId,
      inventoryLocationId: locationId,
      type: "RECEIPT",
      physicalDelta: line.quantity,
      referenceType: "GOODS_RECEIPT",
      referenceId: receipt.id,
      userId: actor.userId,
    });

    await tx.orderItem.update({ where: { id: item.id }, data: { quantityReceived: { increment: line.quantity } } });

    // FIFO-Zuteilung an offene Reservierungen dieser Position
    const waiting = await tx.employeeReservation.findMany({
      where: { orderItemId: item.id, status: "ORDERED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { employee: true, quotaGroup: { select: { isQuotaRelevant: true } } },
    });

    let remaining = line.quantity;
    for (const r of waiting) {
      if (remaining === 0) break;
      const take = Math.min(r.quantity, remaining);
      remaining -= take;

      const direct = directIssue.has(r.id);
      // bedingtes Update zuerst: eine parallel stornierte Reservierung wird nicht mehr bedient
      const updated = await tx.employeeReservation.updateMany({
        where: { id: r.id, status: "ORDERED" },
        data: {
          quantity: take,
          status: direct ? "ISSUED" : "RECEIVED",
          receivedAt: new Date(),
          inventoryLocationId: direct ? null : locationId,
        },
      });
      if (updated.count === 0) {
        remaining += take;
        continue;
      }
      if (take < r.quantity) {
        // Split: die gelieferte Teilmenge ist zugeteilt, der Rest bleibt als eigene Reservierung bestellt
        await tx.employeeReservation.create({
          data: {
            employeeId: r.employeeId,
            articleVariantId: r.articleVariantId,
            quotaGroupId: r.quotaGroupId,
            quotaYear: r.quotaYear,
            quantity: r.quantity - take,
            status: "ORDERED",
            orderItemId: r.orderItemId,
            splitFromId: r.id,
            notes: r.notes,
            createdById: r.createdById,
            createdAt: r.createdAt,
          },
        });
      }
      allocations.push({ reservationId: r.id, quantity: take, direct });

      if (direct) {
        assertEmployeeActive(r.employee);
        const issueNumber = await nextDocumentNumber(tx, "issue");
        const issue = await tx.clothingIssue.create({
          data: {
            issueNumber,
            employeeId: r.employeeId,
            departmentIdSnapshot: r.employee.departmentId,
            issuedById: actor.userId,
            clientRequestId: `${input.clientRequestId}:issue:${r.id}`,
            notes: `Direktausgabe bei Wareneingang ${receiptNumber}`,
            items: {
              create: {
                articleVariantId: r.articleVariantId,
                inventoryLocationId: locationId,
                quantity: take,
                quotaGroupId: r.quotaGroupId,
                quotaYear: r.quotaYear,
                quotaRelevant: r.quotaGroup.isQuotaRelevant,
                unitCost: unitCosts.get(item.articleVariant.articleId) ?? null,
                reservationId: r.id,
              },
            },
          },
        });
        await applyStockChange(tx, {
          articleVariantId: r.articleVariantId,
          inventoryLocationId: locationId,
          type: "ISSUE",
          physicalDelta: -take,
          referenceType: "CLOTHING_ISSUE",
          referenceId: issue.id,
          userId: actor.userId,
        });
        await audit(tx, {
          actorId: actor.userId,
          action: "CLOTHING_ISSUED",
          entityType: "ClothingIssue",
          entityId: issue.id,
          newValue: { issueNumber, employeeNumber: r.employee.employeeNumber, variantSku: item.articleVariant.variantSku, quantity: take, receiptNumber },
        });
        issuedDirectly += take;
      } else {
        await applyStockChange(tx, {
          articleVariantId: r.articleVariantId,
          inventoryLocationId: locationId,
          type: "RESERVE",
          physicalDelta: 0,
          reservedDelta: take,
          referenceType: "RESERVATION",
          referenceId: r.id,
          userId: actor.userId,
        });
        reservedForEmployees += take;
      }
    }
    toFreeStock += remaining;
  }

  const unknownDirect = input.directIssueReservationIds.filter((id) => !allocations.some((a) => a.reservationId === id));
  if (unknownDirect.length) {
    throw invalidState("Mindestens eine zur Direktausgabe markierte Reservierung konnte mit dieser Lieferung nicht bedient werden.");
  }

  const items = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { quantityOrdered: true, quantityReceived: true } });
  const newStatus = deriveReceiptStatus(items);
  if (newStatus && newStatus !== order.status) {
    await tx.order.update({ where: { id: order.id }, data: { status: newStatus } });
  }

  await audit(tx, {
    actorId: actor.userId,
    action: "GOODS_RECEIVED",
    entityType: "GoodsReceipt",
    entityId: receipt.id,
    newValue: {
      receiptNumber,
      orderNumber: order.orderNumber,
      items: lines.map((l) => ({ variantSku: itemById.get(l.orderItemId)!.articleVariant.variantSku, quantity: l.quantity })),
      allocations,
      orderStatus: newStatus ?? order.status,
    },
  });

  return { receiptId: receipt.id, receiptNumber, reservedForEmployees, issuedDirectly, toFreeStock };
}
