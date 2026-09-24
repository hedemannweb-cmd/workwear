import "server-only";
import { currentYear } from "@/lib/dates";
import { getEmployeeQuota } from "@/modules/quotas/server/quota-service";
import { type Actor, can } from "@/server/actor";
import { db } from "@/server/db";
import { getEmployee } from "./employees";

/** Alles, was die Mitarbeiterdetailseite braucht (Vorgabe 23/48), in einem Aufruf. */
export async function getEmployeeDetail(actor: Actor, id: string, year: number) {
  const employee = await getEmployee(actor, id);

  const [quota, reservations, issues, years] = await Promise.all([
    can(actor, "quota:view") ? getEmployeeQuota(id, year) : Promise.resolve([]),
    db.employeeReservation.findMany({
      where: { employeeId: id, status: { in: ["PENDING", "ORDERED", "RECEIVED"] } },
      orderBy: { createdAt: "asc" },
      include: {
        articleVariant: { include: { article: { select: { name: true } }, size: true } },
        orderItem: { include: { order: { select: { id: true, orderNumber: true, expectedDeliveryDate: true, status: true } } } },
        inventoryLocation: { select: { name: true } },
      },
    }),
    db.clothingIssue.findMany({
      where: { employeeId: id },
      orderBy: { issuedAt: "desc" },
      take: 200,
      include: {
        issuedBy: { select: { name: true } },
        cancelledBy: { select: { name: true } },
        items: {
          include: {
            articleVariant: { include: { article: { select: { name: true, quotaGroupId: true } }, size: true } },
            inventoryLocation: { select: { name: true } },
            returnItems: { include: { return: { select: { returnNumber: true, returnedAt: true } } } },
          },
        },
      },
    }),
    db.clothingIssueItem.findMany({
      where: { issue: { employeeId: id } },
      distinct: ["quotaYear"],
      select: { quotaYear: true },
    }),
  ]);

  // Jahre mit Buchungen sowie laufendes und nächstes Jahr (Jahreswechsel vorbereiten)
  const availableYears = [...new Set([year, currentYear(), currentYear() + 1, ...years.map((y) => y.quotaYear)])]
    .filter((y) => y >= employee.entryDate.getUTCFullYear())
    .sort((a, b) => b - a);

  return { employee, quota, reservations, issues, availableYears };
}
