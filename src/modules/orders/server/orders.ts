import "server-only";
import { z } from "zod";
import type { OrderStatus } from "@/generated/prisma/enums";
import { dateOnly } from "@/lib/dates";
import { type Actor, assertCan } from "@/server/actor";
import { audit } from "@/server/audit";
import { DomainError, invalidState, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import { lockOrder, runInTransaction } from "@/server/tx";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum");

export const createPurchaseOrderSchema = z
  .object({
    supplierId: z.string().min(1),
    /** Mitarbeiterreservierungen (Status PENDING), die in diese Bestellung aufgenommen werden */
    reservationIds: z.array(z.string().min(1)).max(500).default([]),
    /** zusätzliche Lagermengen ohne Mitarbeiterbezug */
    stockItems: z
      .array(z.object({ articleVariantId: z.string().min(1), quantity: z.number().int().min(1).max(9999) }))
      .max(200)
      .default([]),
    /** abweichende Einzelpreise je Variante; sonst Preis aus ArticleSupplier */
    unitPrices: z.record(z.string(), z.number().min(0).max(100000)).default({}),
    expectedDeliveryDate: isoDate.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.reservationIds.length + v.stockItems.length > 0, { message: "Die Bestellung enthält keine Positionen." });

/**
 * Bestellung anlegen (Status DRAFT, KONZEPT.md G.2). Reservierungen werden je Variante zu einer
 * Bestellposition zusammengefasst (Sammelbestellung); jede Reservierung bleibt über orderItemId
 * ihrer Position zugeordnet. Lagermengen erhöhen die Position ohne Mitarbeiterbezug.
 */
export async function createPurchaseOrder(actor: Actor, rawInput: z.input<typeof createPurchaseOrderSchema>) {
  assertCan(actor, "order:manage");
  const input = createPurchaseOrderSchema.parse(rawInput);

  return runInTransaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || !supplier.active) throw notFound("Der Lieferant");

    const reservations = input.reservationIds.length
      ? await tx.employeeReservation.findMany({ where: { id: { in: input.reservationIds } } })
      : [];
    if (reservations.length !== input.reservationIds.length) throw notFound("Eine Reservierung");

    const qtyByVariant = new Map<string, { quantity: number; reservationIds: string[] }>();
    for (const r of reservations) {
      const entry = qtyByVariant.get(r.articleVariantId) ?? { quantity: 0, reservationIds: [] };
      entry.quantity += r.quantity;
      entry.reservationIds.push(r.id);
      qtyByVariant.set(r.articleVariantId, entry);
    }
    for (const s of input.stockItems) {
      const entry = qtyByVariant.get(s.articleVariantId) ?? { quantity: 0, reservationIds: [] };
      entry.quantity += s.quantity;
      qtyByVariant.set(s.articleVariantId, entry);
    }

    const variants = await tx.articleVariant.findMany({
      where: { id: { in: [...qtyByVariant.keys()] } },
      select: {
        id: true,
        active: true,
        variantSku: true,
        article: { select: { id: true, name: true, suppliers: { where: { supplierId: supplier.id }, select: { purchasePrice: true } } } },
      },
    });
    if (variants.length !== qtyByVariant.size) throw notFound("Eine Artikelvariante");
    for (const v of variants) {
      if (!v.active) throw new DomainError("ARTICLE_INACTIVE", `Die Variante ${v.variantSku} ist nicht aktiv.`);
    }

    const orderNumber = await nextDocumentNumber(tx, "order");
    const order = await tx.order.create({
      data: {
        orderNumber,
        supplierId: supplier.id,
        status: "DRAFT",
        expectedDeliveryDate: input.expectedDeliveryDate ? dateOnly(input.expectedDeliveryDate) : null,
        notes: input.notes || null,
        createdById: actor.userId,
      },
    });

    for (const v of variants) {
      const entry = qtyByVariant.get(v.id)!;
      const price = input.unitPrices[v.id] ?? Number(v.article.suppliers[0]?.purchasePrice ?? 0);
      const item = await tx.orderItem.create({
        data: { orderId: order.id, articleVariantId: v.id, quantityOrdered: entry.quantity, unitPrice: price.toFixed(2) },
      });
      if (entry.reservationIds.length) {
        // bedingtes Update: parallel stornierte oder bereits bestellte Reservierungen werden erkannt
        const updated = await tx.employeeReservation.updateMany({
          where: { id: { in: entry.reservationIds }, status: "PENDING" },
          data: { status: "ORDERED", orderItemId: item.id },
        });
        if (updated.count !== entry.reservationIds.length) {
          throw invalidState("Mindestens eine Reservierung ist nicht mehr offen (bereits bestellt oder storniert). Bitte die Liste aktualisieren.");
        }
      }
    }

    await audit(tx, {
      actorId: actor.userId,
      action: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      newValue: {
        orderNumber,
        supplier: supplier.name,
        items: variants.map((v) => ({ variantSku: v.variantSku, quantity: qtyByVariant.get(v.id)!.quantity })),
        reservations: input.reservationIds.length,
      },
    });

    return { orderId: order.id, orderNumber };
  });
}

export const markOrderedSchema = z.object({
  orderId: z.string().min(1),
  orderDate: isoDate,
  expectedDeliveryDate: isoDate.optional(),
});

/** Bestellung als beim Lieferanten bestellt markieren (DRAFT → ORDERED). */
export async function markOrderOrdered(actor: Actor, rawInput: z.input<typeof markOrderedSchema>) {
  assertCan(actor, "order:manage");
  const input = markOrderedSchema.parse(rawInput);
  await transition(actor, input.orderId, ["DRAFT"], "ORDERED", async (tx, order) => {
    let expected = input.expectedDeliveryDate ? dateOnly(input.expectedDeliveryDate) : order.expectedDeliveryDate;
    if (!expected) {
      // Standard: Lieferzeit des Lieferanten (größte Lieferzeit der enthaltenen Artikel)
      const leadTimes = await tx.articleSupplier.findMany({
        where: { supplierId: order.supplierId, article: { variants: { some: { orderItems: { some: { orderId: order.id } } } } } },
        select: { leadTimeDays: true },
      });
      const days = Math.max(0, ...leadTimes.map((l) => l.leadTimeDays ?? 0));
      if (days > 0) expected = new Date(dateOnly(input.orderDate).getTime() + days * 86_400_000);
    }
    if (expected && expected < dateOnly(input.orderDate)) {
      throw new DomainError("VALIDATION", "Der Liefertermin darf nicht vor dem Bestelldatum liegen.");
    }
    return { orderDate: dateOnly(input.orderDate), expectedDeliveryDate: expected };
  });
}

/** Auftragsbestätigung des Lieferanten erfassen (ORDERED → CONFIRMED), optional mit neuem Liefertermin. */
export async function confirmOrder(actor: Actor, rawInput: { orderId: string; expectedDeliveryDate?: string }) {
  assertCan(actor, "order:manage");
  const input = z.object({ orderId: z.string().min(1), expectedDeliveryDate: isoDate.optional() }).parse(rawInput);
  await transition(actor, input.orderId, ["ORDERED"], "CONFIRMED", async () =>
    input.expectedDeliveryDate ? { expectedDeliveryDate: dateOnly(input.expectedDeliveryDate) } : {},
  );
}

export const cancelOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(5, "Bitte eine Begründung (mind. 5 Zeichen) angeben.").max(500),
});

/**
 * Bestellung stornieren (nur ohne Wareneingang). Verknüpfte Reservierungen gehen zurück auf PENDING –
 * der Bedarf der Mitarbeiter besteht weiter und erscheint wieder im Bedarf.
 */
export async function cancelOrder(actor: Actor, rawInput: z.input<typeof cancelOrderSchema>) {
  assertCan(actor, "order:cancel");
  const input = cancelOrderSchema.parse(rawInput);
  await transition(actor, input.orderId, ["DRAFT", "ORDERED", "CONFIRMED"], "CANCELLED", async (tx, order) => {
    const received = await tx.orderItem.aggregate({ where: { orderId: order.id }, _sum: { quantityReceived: true } });
    if ((received._sum.quantityReceived ?? 0) > 0) {
      throw invalidState("Zu dieser Bestellung wurde bereits Ware geliefert; sie kann nicht mehr storniert werden.");
    }
    await tx.employeeReservation.updateMany({
      where: { orderItem: { orderId: order.id }, status: "ORDERED" },
      data: { status: "PENDING", orderItemId: null },
    });
    return { cancelledAt: new Date(), cancelReason: input.reason };
  }, input.reason);
}

type OrderRow = { id: string; status: OrderStatus; supplierId: string; expectedDeliveryDate: Date | null; orderNumber: string };

async function transition(
  actor: Actor,
  orderId: string,
  from: OrderStatus[],
  to: OrderStatus,
  extra: (tx: Parameters<Parameters<typeof runInTransaction>[0]>[0], order: OrderRow) => Promise<Record<string, unknown>>,
  reason?: string,
) {
  await runInTransaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, supplierId: true, expectedDeliveryDate: true, orderNumber: true },
    });
    if (!order) throw notFound("Die Bestellung");
    if (!from.includes(order.status)) {
      throw invalidState(`Die Bestellung hat den Status ${ORDER_STATUS_LABEL[order.status]}; diese Aktion ist nicht möglich.`);
    }
    const data = await extra(tx, order);
    await tx.order.update({ where: { id: order.id }, data: { status: to, ...data } });
    await audit(tx, {
      actorId: actor.userId,
      action: to === "CANCELLED" ? "ORDER_CANCELLED" : "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: order.id,
      oldValue: { status: order.status },
      newValue: { status: to, ...data },
      reason,
    });
  });
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "Entwurf",
  ORDERED: "Bestellt",
  CONFIRMED: "Bestätigt",
  PARTIALLY_RECEIVED: "Teilweise geliefert",
  RECEIVED: "Geliefert",
  CANCELLED: "Storniert",
};

/** Status aus den Positionen ableiten – nie manuell setzen (KONZEPT.md G.1). */
export function deriveReceiptStatus(items: Array<{ quantityOrdered: number; quantityReceived: number }>): OrderStatus | null {
  const received = items.reduce((s, i) => s + i.quantityReceived, 0);
  if (received === 0) return null;
  return items.every((i) => i.quantityReceived >= i.quantityOrdered) ? "RECEIVED" : "PARTIALLY_RECEIVED";
}
