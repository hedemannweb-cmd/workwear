import "server-only";
import { db } from "@/server/db";

/** Bestandsübersicht: alle aktiven Varianten × Lagerorte (auch ohne Bestand, damit Nullbestände sichtbar sind). */
export async function listInventory() {
  const [variants, locations, rows] = await Promise.all([
    db.articleVariant.findMany({
      where: { active: true, article: { active: true } },
      include: { article: { select: { id: true, name: true, sku: true, isStockItem: true } }, size: true },
    }),
    db.inventoryLocation.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.inventory.findMany(),
  ]);
  const byKey = new Map(rows.map((r) => [`${r.articleVariantId}:${r.inventoryLocationId}`, r]));
  const out = [];
  for (const v of variants) {
    for (const l of locations) {
      const r = byKey.get(`${v.id}:${l.id}`);
      if (l.type === "DEFECTIVE" && !r?.physicalQuantity) continue; // Ausschusslager nur mit Bestand zeigen
      const physical = r?.physicalQuantity ?? 0;
      const reserved = r?.reservedQuantity ?? 0;
      const minStock = l.type === "STORAGE" ? (r?.minStock ?? v.minStock) : null;
      out.push({
        key: `${v.id}:${l.id}`,
        articleId: v.article.id,
        articleName: v.article.name,
        sku: v.variantSku,
        size: v.size?.value ?? null,
        sizeSort: v.size?.sortOrder ?? 0,
        color: v.color,
        variantId: v.id,
        locationId: l.id,
        location: l.name,
        locationType: l.type,
        physical,
        reserved,
        free: physical - reserved,
        minStock,
      });
    }
  }
  out.sort((a, b) => a.articleName.localeCompare(b.articleName, "de") || (a.color ?? "").localeCompare(b.color ?? "") || a.sizeSort - b.sizeSort || a.location.localeCompare(b.location));
  return { rows: out, locations };
}

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Wareneingang",
  ISSUE: "Ausgabe",
  ISSUE_CANCELLATION: "Storno Ausgabe",
  RETURN: "Rückgabe",
  TRANSFER_OUT: "Umlagerung (ab)",
  TRANSFER_IN: "Umlagerung (zu)",
  ADJUSTMENT: "Korrektur",
  INVENTORY_COUNT: "Inventur",
  RESERVE: "Reservierung",
  UNRESERVE: "Freigabe Reservierung",
};

export async function listMovements(filter: { articleId?: string; limit?: number }) {
  const movements = await db.inventoryMovement.findMany({
    where: filter.articleId ? { articleVariant: { articleId: filter.articleId } } : {},
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 500,
    include: {
      articleVariant: { include: { article: { select: { name: true } }, size: true } },
      inventoryLocation: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  // Belegnummern für die Referenzen nachladen (für die Nachvollziehbarkeit ohne Freitext)
  const ids = (type: string) => movements.filter((m) => m.referenceType === type).map((m) => m.referenceId);
  const [issues, receipts, returns] = await Promise.all([
    db.clothingIssue.findMany({ where: { id: { in: ids("CLOTHING_ISSUE") } }, select: { id: true, issueNumber: true, employee: { select: { id: true, firstName: true, lastName: true } } } }),
    db.goodsReceipt.findMany({ where: { id: { in: ids("GOODS_RECEIPT") } }, select: { id: true, receiptNumber: true, orderId: true } }),
    db.clothingReturn.findMany({ where: { id: { in: ids("CLOTHING_RETURN") } }, select: { id: true, returnNumber: true, employeeId: true } }),
  ]);
  return movements.map((m) => {
    let reference: { label: string; href?: string } | null = null;
    if (m.referenceType === "CLOTHING_ISSUE") {
      const i = issues.find((x) => x.id === m.referenceId);
      if (i) reference = { label: `${i.issueNumber} · ${i.employee.firstName} ${i.employee.lastName}`, href: `/employees/${i.employee.id}` };
    } else if (m.referenceType === "GOODS_RECEIPT") {
      const r = receipts.find((x) => x.id === m.referenceId);
      if (r) reference = { label: r.receiptNumber, href: r.orderId ? `/orders/${r.orderId}` : undefined };
    } else if (m.referenceType === "CLOTHING_RETURN") {
      const r = returns.find((x) => x.id === m.referenceId);
      if (r) reference = { label: r.returnNumber, href: `/employees/${r.employeeId}` };
    }
    return {
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      type: m.type,
      typeLabel: MOVEMENT_LABEL[m.type] ?? m.type,
      article: [m.articleVariant.article.name, m.articleVariant.color, m.articleVariant.size?.value].filter(Boolean).join(" · "),
      location: m.inventoryLocation.name,
      quantityDelta: m.quantityDelta,
      reservedDelta: m.reservedDelta,
      physicalAfter: m.physicalAfter,
      reservedAfter: m.reservedAfter,
      user: m.user.name,
      reason: m.reason,
      reference,
    };
  });
}
