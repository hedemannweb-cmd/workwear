import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { currentYear, startOfDayInAppTz, toIsoDateInAppTz, todayDateOnly } from "@/lib/dates";
import { type Actor, can, employeeScopeWhere } from "@/server/actor";
import { db } from "@/server/db";

const OPEN_ORDER = ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"] as const;

/** Varianten unter Mindestbestand (frei verfügbar < Mindestbestand), über alle Lagerorte vom Typ STORAGE. */
export async function variantsBelowMinimum() {
  return db.$queryRaw<Array<{ id: string; variantSku: string; articleId: string; articleName: string; size: string | null; free: number; minStock: number; openOrdered: number }>>`
    SELECT v."id", v."variantSku", a."id" AS "articleId", a."name" AS "articleName", s."value" AS size,
           COALESCE(SUM(i."physicalQuantity" - i."reservedQuantity"), 0)::int AS free,
           v."minStock"::int AS "minStock",
           COALESCE((SELECT SUM(oi."quantityOrdered" - oi."quantityReceived") FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
                      WHERE oi."articleVariantId" = v."id" AND o."status" IN ('DRAFT','ORDERED','CONFIRMED','PARTIALLY_RECEIVED')), 0)::int AS "openOrdered"
      FROM "ArticleVariant" v
      JOIN "Article" a ON a."id" = v."articleId"
      LEFT JOIN "Size" s ON s."id" = v."sizeId"
      LEFT JOIN "Inventory" i ON i."articleVariantId" = v."id"
           AND i."inventoryLocationId" IN (SELECT "id" FROM "InventoryLocation" WHERE "type" = 'STORAGE' AND "active")
     WHERE v."active" AND a."active" AND a."isStockItem" AND v."minStock" IS NOT NULL
     GROUP BY v."id", a."id", s."value", s."sortOrder"
    HAVING COALESCE(SUM(i."physicalQuantity" - i."reservedQuantity"), 0) < v."minStock"
     ORDER BY a."name", s."sortOrder"`;
}

export async function getDashboard(actor: Actor) {
  const year = currentYear();
  const today = todayDateOnly();
  const monthStart = startOfDayInAppTz(`${toIsoDateInAppTz(new Date()).slice(0, 7)}-01`);
  const empScope = employeeScopeWhere(actor);
  const yearStart = new Date(`${year}-01-01T00:00:00Z`);
  const nextYearStart = new Date(`${year + 1}-01-01T00:00:00Z`);

  const [
    activeEmployees,
    openOrders,
    draftOrders,
    overdueOrders,
    reservationsByStatus,
    issuedThisMonth,
    belowMin,
    orderCost,
    recentIssues,
  ] = await Promise.all([
    db.employee.count({ where: { ...empScope, status: "ACTIVE" } }),
    can(actor, "order:view") ? db.order.count({ where: { status: { in: [...OPEN_ORDER] } } }) : 0,
    can(actor, "order:view") ? db.order.count({ where: { status: "DRAFT" } }) : 0,
    can(actor, "order:view")
      ? db.order.findMany({
          where: { status: { in: [...OPEN_ORDER] }, expectedDeliveryDate: { lt: today } },
          orderBy: { expectedDeliveryDate: "asc" },
          select: { id: true, orderNumber: true, expectedDeliveryDate: true, supplier: { select: { name: true } } },
        })
      : [],
    db.employeeReservation.groupBy({
      by: ["status"],
      where: { status: { in: ["PENDING", "ORDERED", "RECEIVED"] }, employee: empScope },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    db.clothingIssueItem.aggregate({
      where: { issue: { status: "COMPLETED", issuedAt: { gte: monthStart }, employee: empScope } },
      _sum: { quantity: true },
    }),
    can(actor, "inventory:view") ? variantsBelowMinimum() : [],
    can(actor, "report:view")
      ? db.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
          SELECT SUM(oi."quantityOrdered" * oi."unitPrice") AS total
            FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
           WHERE o."status" NOT IN ('DRAFT','CANCELLED') AND o."orderDate" >= ${yearStart} AND o."orderDate" < ${nextYearStart}`
      : [],
    db.clothingIssue.findMany({
      where: { employee: empScope },
      orderBy: { issuedAt: "desc" },
      take: 8,
      select: {
        id: true,
        issueNumber: true,
        issuedAt: true,
        status: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        items: { select: { quantity: true } },
      },
    }),
  ]);

  const res = (status: string) => reservationsByStatus.find((r) => r.status === status);
  return {
    year,
    kpis: {
      activeEmployees,
      openOrders,
      openReservations: reservationsByStatus.reduce((s, r) => s + r._count._all, 0),
      overdueOrders: overdueOrders.length,
      belowMinimum: belowMin.length,
      issuedThisMonth: issuedThisMonth._sum.quantity ?? 0,
      orderCostYear: orderCost[0]?.total ? Number(orderCost[0].total) : can(actor, "report:view") ? 0 : null,
    },
    actions: {
      belowMinimum: belowMin.length,
      pendingDemand: res("PENDING")?._count._all ?? 0,
      pendingDemandQty: res("PENDING")?._sum.quantity ?? 0,
      arrivedWaiting: res("RECEIVED")?._count._all ?? 0,
      arrivedWaitingQty: res("RECEIVED")?._sum.quantity ?? 0,
      openOrders,
      draftOrders,
      overdue: overdueOrders,
    },
    belowMin: belowMin.slice(0, 8),
    recentIssues,
  };
}

/** Datenqualitätsprüfung (Vorgabe 54), nur für Administratoren/Manager. */
export async function getDataQuality() {
  const [withoutSizes, deptWithoutProfile, articlesWithoutSupplier, articlesWithoutPrice, stalePending, inconsistent] = await Promise.all([
    db.employee.findMany({ where: { status: "ACTIVE", sizes: { none: {} } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } }),
    db.department.findMany({ where: { active: true, quotaProfileId: null }, select: { id: true, name: true } }),
    db.article.findMany({ where: { active: true, suppliers: { none: {} } }, select: { id: true, sku: true, name: true } }),
    db.article.findMany({ where: { active: true, suppliers: { some: {} }, NOT: { suppliers: { some: { purchasePrice: { not: null } } } } }, select: { id: true, sku: true, name: true } }),
    db.employeeReservation.count({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } }),
    db.$queryRaw<Array<{ id: string }>>`
      SELECT i."id" FROM "Inventory" i
       WHERE i."physicalQuantity" <> COALESCE((SELECT SUM(m."quantityDelta") FROM "InventoryMovement" m WHERE m."articleVariantId" = i."articleVariantId" AND m."inventoryLocationId" = i."inventoryLocationId"), 0)
          OR i."reservedQuantity" <> COALESCE((SELECT SUM(m."reservedDelta") FROM "InventoryMovement" m WHERE m."articleVariantId" = i."articleVariantId" AND m."inventoryLocationId" = i."inventoryLocationId"), 0)`,
  ]);
  return { withoutSizes, deptWithoutProfile, articlesWithoutSupplier, articlesWithoutPrice, stalePending, inconsistentInventory: inconsistent.length };
}
