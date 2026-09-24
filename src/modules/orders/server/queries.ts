import "server-only";
import { todayDateOnly } from "@/lib/dates";
import { type Actor, employeeScopeWhere } from "@/server/actor";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";

const variantLabel = (v: { color: string | null; article: { name: string }; size: { value: string } | null }) =>
  [v.article.name, v.color, v.size?.value].filter(Boolean).join(" · ");

/** Offener Bedarf: Reservierungen, die noch nicht bestellt sind – gruppiert nach Vorzugslieferant. */
export async function getDemand(actor: Actor) {
  const [reservations, stock] = await Promise.all([
    db.employeeReservation.findMany({
      where: { status: "PENDING", employee: employeeScopeWhere(actor) },
      orderBy: { createdAt: "asc" },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, department: { select: { name: true } } } },
        articleVariant: {
          include: {
            size: true,
            article: { select: { id: true, name: true, sku: true, suppliers: { where: { isPreferred: true }, include: { supplier: { select: { id: true, name: true } } } } } },
          },
        },
        createdBy: { select: { name: true } },
      },
    }),
    db.inventory.groupBy({ by: ["articleVariantId"], where: { inventoryLocation: { type: "STORAGE" } }, _sum: { physicalQuantity: true, reservedQuantity: true } }),
  ]);
  const free = new Map(stock.map((s) => [s.articleVariantId, (s._sum.physicalQuantity ?? 0) - (s._sum.reservedQuantity ?? 0)]));
  return reservations.map((r) => {
    const pref = r.articleVariant.article.suppliers[0];
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      quantity: r.quantity,
      quotaYear: r.quotaYear,
      employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`, number: r.employee.employeeNumber, department: r.employee.department.name },
      variantId: r.articleVariantId,
      variant: variantLabel(r.articleVariant),
      sku: r.articleVariant.variantSku,
      supplierId: pref?.supplier.id ?? null,
      supplier: pref?.supplier.name ?? null,
      unitPrice: pref?.purchasePrice ? Number(pref.purchasePrice) : null,
      freeNow: Math.max(0, free.get(r.articleVariantId) ?? 0),
      createdBy: r.createdBy.name,
    };
  });
}

/** Eingetroffene Ware, die auf Ausgabe an den Mitarbeiter wartet. */
export async function getArrived(actor: Actor) {
  const rows = await db.employeeReservation.findMany({
    where: { status: "RECEIVED", employee: employeeScopeWhere(actor) },
    orderBy: { receivedAt: "asc" },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, department: { select: { name: true } } } },
      articleVariant: { include: { size: true, article: { select: { name: true } } } },
      inventoryLocation: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    quantity: r.quantity,
    employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`, number: r.employee.employeeNumber, department: r.employee.department.name },
    variant: variantLabel(r.articleVariant),
    location: r.inventoryLocation?.name ?? "–",
  }));
}

export async function listOrders() {
  const today = todayDateOnly();
  const orders = await db.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      items: { select: { quantityOrdered: true, quantityReceived: true, unitPrice: true } },
      createdBy: { select: { name: true } },
    },
  });
  return orders.map((o) => {
    const open = ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      supplier: o.supplier.name,
      status: o.status,
      orderDate: o.orderDate?.toISOString() ?? null,
      expectedDeliveryDate: o.expectedDeliveryDate?.toISOString() ?? null,
      overdue: open && !!o.expectedDeliveryDate && o.expectedDeliveryDate < today,
      ordered: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
      received: o.items.reduce((s, i) => s + i.quantityReceived, 0),
      total: o.items.reduce((s, i) => s + i.quantityOrdered * Number(i.unitPrice), 0),
      createdBy: o.createdBy.name,
      createdAt: o.createdAt.toISOString(),
    };
  });
}

export async function getOrder(id: string) {
  const order = await db.order.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      items: {
        include: {
          articleVariant: { include: { size: true, article: { select: { id: true, name: true, sku: true, suppliers: { select: { supplierId: true, supplierSku: true } } } } } },
          reservations: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
          },
        },
      },
      goodsReceipts: { orderBy: { receivedAt: "desc" }, include: { receivedBy: { select: { name: true } }, items: true } },
    },
  });
  if (!order) throw notFound("Die Bestellung");
  const today = todayDateOnly();
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    supplier: { id: order.supplier.id, name: order.supplier.name, email: order.supplier.email, contactPerson: order.supplier.contactPerson },
    orderDate: order.orderDate?.toISOString() ?? null,
    expectedDeliveryDate: order.expectedDeliveryDate?.toISOString() ?? null,
    overdue: ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(order.status) && !!order.expectedDeliveryDate && order.expectedDeliveryDate < today,
    notes: order.notes,
    cancelReason: order.cancelReason,
    createdBy: order.createdBy.name,
    createdAt: order.createdAt.toISOString(),
    items: order.items
      .map((i) => ({
        id: i.id,
        variantId: i.articleVariantId,
        articleId: i.articleVariant.article.id,
        label: variantLabel(i.articleVariant),
        sku: i.articleVariant.variantSku,
        supplierSku: i.articleVariant.article.suppliers.find((s) => s.supplierId === order.supplierId)?.supplierSku ?? null,
        sizeSort: i.articleVariant.size?.sortOrder ?? 0,
        quantityOrdered: i.quantityOrdered,
        quantityReceived: i.quantityReceived,
        unitPrice: Number(i.unitPrice),
        reservations: i.reservations.map((r) => ({
          id: r.id,
          status: r.status,
          quantity: r.quantity,
          employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`, number: r.employee.employeeNumber },
        })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "de") || a.sizeSort - b.sizeSort),
    receipts: order.goodsReceipts.map((g) => ({
      id: g.id,
      receiptNumber: g.receiptNumber,
      receivedAt: g.receivedAt.toISOString(),
      receivedBy: g.receivedBy.name,
      deliveryNoteNumber: g.deliveryNoteNumber,
      quantity: g.items.reduce((s, x) => s + x.quantity, 0),
    })),
  };
}

export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;

/** Vorschlag für eine Lagerbestellung beim Lieferanten: Varianten mit Bestand, Mindestbestand und offener Menge. */
export async function getStockOrderCandidates(supplierId: string) {
  const links = await db.articleSupplier.findMany({
    where: { supplierId, article: { active: true } },
    include: { article: { include: { variants: { where: { active: true }, include: { size: true } } } } },
  });
  const variantIds = links.flatMap((l) => l.article.variants.map((v) => v.id));
  const [stock, openOrders] = await Promise.all([
    db.inventory.groupBy({ by: ["articleVariantId"], where: { articleVariantId: { in: variantIds }, inventoryLocation: { type: "STORAGE" } }, _sum: { physicalQuantity: true, reservedQuantity: true } }),
    db.orderItem.groupBy({
      by: ["articleVariantId"],
      where: { articleVariantId: { in: variantIds }, order: { status: { in: ["DRAFT", "ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"] } } },
      _sum: { quantityOrdered: true, quantityReceived: true },
    }),
  ]);
  const free = new Map(stock.map((s) => [s.articleVariantId, (s._sum.physicalQuantity ?? 0) - (s._sum.reservedQuantity ?? 0)]));
  const open = new Map(openOrders.map((o) => [o.articleVariantId, (o._sum.quantityOrdered ?? 0) - (o._sum.quantityReceived ?? 0)]));
  return links
    .flatMap((l) =>
      l.article.variants.map((v) => {
        const f = free.get(v.id) ?? 0;
        const o = open.get(v.id) ?? 0;
        return {
          variantId: v.id,
          label: [l.article.name, v.color, v.size?.value].filter(Boolean).join(" · "),
          sizeSort: v.size?.sortOrder ?? 0,
          free: f,
          openOrdered: o,
          minStock: v.minStock,
          unitPrice: l.purchasePrice ? Number(l.purchasePrice) : null,
          // Vorschlag (Vorgabe 53): auf Mindestbestand auffüllen, bereits Bestelltes berücksichtigen – nie automatisch senden
          suggested: v.minStock !== null ? Math.max(0, v.minStock - f - o) : 0,
        };
      }),
    )
    .sort((a, b) => a.label.localeCompare(b.label, "de") || a.sizeSort - b.sizeSort);
}

export async function listGoodsReceipts() {
  const rows = await db.goodsReceipt.findMany({
    orderBy: { receivedAt: "desc" },
    take: 300,
    include: { supplier: { select: { name: true } }, order: { select: { id: true, orderNumber: true } }, receivedBy: { select: { name: true } }, items: { select: { quantity: true } } },
  });
  return rows.map((g) => ({
    id: g.id,
    receiptNumber: g.receiptNumber,
    receivedAt: g.receivedAt.toISOString(),
    supplier: g.supplier.name,
    order: g.order,
    deliveryNoteNumber: g.deliveryNoteNumber,
    receivedBy: g.receivedBy.name,
    quantity: g.items.reduce((s, i) => s + i.quantity, 0),
  }));
}
