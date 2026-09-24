import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { currentYear } from "@/lib/dates";
import { getEmployeeQuota } from "@/modules/quotas/server/quota-service";
import { type Actor, can } from "@/server/actor";
import { db } from "@/server/db";

export type SearchResult = {
  employees: Array<{
    id: string;
    employeeNumber: string;
    name: string;
    department: string;
    status: string;
    quota: Array<{ group: string; available: number | null }>;
  }>;
  articles: Array<{ id: string; sku: string; name: string }>;
  orders: Array<{ id: string; orderNumber: string; supplier: string; status: string }>;
};

/**
 * Globale Suche (Vorgabe 25): Personalnummer/SKU/Bestellnummer per Präfix, Namen fehlertolerant
 * über pg_trgm (word_similarity). Mitarbeiter werden auf den Abteilungs-Scope des Benutzers begrenzt.
 * Die ersten Mitarbeitertreffer enthalten die Schnellansicht des verfügbaren Kontingents (Vorgabe 52).
 */
export async function globalSearch(actor: Actor, rawQuery: string): Promise<SearchResult> {
  const q = rawQuery.trim().slice(0, 100);
  const empty: SearchResult = { employees: [], articles: [], orders: [] };
  if (q.length < 2) return empty;
  const like = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const contains = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const scope =
    actor.departmentIds === null
      ? Prisma.empty
      : actor.departmentIds.length === 0
        ? Prisma.sql`AND false`
        : Prisma.sql`AND e."departmentId" IN (${Prisma.join(actor.departmentIds)})`;

  const employees = can(actor, "employee:view")
    ? await db.$queryRaw<Array<{ id: string; employeeNumber: string; firstName: string; lastName: string; department: string; status: string }>>`
        SELECT e."id", e."employeeNumber", e."firstName", e."lastName", d."name" AS department, e."status"::text AS status
          FROM "Employee" e JOIN "Department" d ON d."id" = e."departmentId"
         WHERE (e."employeeNumber" ILIKE ${like}
                OR (e."lastName" || ' ' || e."firstName") ILIKE ${contains}
                OR (e."firstName" || ' ' || e."lastName") ILIKE ${contains}
                OR word_similarity(${q}, e."lastName" || ' ' || e."firstName") > 0.4)
           ${scope}
         ORDER BY (e."employeeNumber" = ${q}) DESC,
                  (e."status" = 'ACTIVE') DESC,
                  word_similarity(${q}, e."lastName" || ' ' || e."firstName") DESC,
                  e."lastName"
         LIMIT 8`
    : [];

  const articles = can(actor, "inventory:view")
    ? await db.$queryRaw<Array<{ id: string; sku: string; name: string }>>`
        SELECT a."id", a."sku", a."name" FROM "Article" a
         WHERE a."sku" ILIKE ${like} OR a."name" ILIKE ${contains} OR word_similarity(${q}, a."name") > 0.4
            OR EXISTS (SELECT 1 FROM "ArticleVariant" v WHERE v."articleId" = a."id" AND (v."variantSku" ILIKE ${like} OR v."barcode" = ${q}))
         ORDER BY a."active" DESC, word_similarity(${q}, a."name") DESC, a."sku"
         LIMIT 6`
    : [];

  const orders = can(actor, "order:view")
    ? await db.$queryRaw<Array<{ id: string; orderNumber: string; supplier: string; status: string }>>`
        SELECT o."id", o."orderNumber", s."name" AS supplier, o."status"::text AS status
          FROM "Order" o JOIN "Supplier" s ON s."id" = o."supplierId"
         WHERE o."orderNumber" ILIKE ${contains}
         ORDER BY o."createdAt" DESC LIMIT 5`
    : [];

  const year = currentYear();
  const withQuota = await Promise.all(
    employees.map(async (e, index) => ({
      id: e.id,
      employeeNumber: e.employeeNumber,
      name: `${e.firstName} ${e.lastName}`,
      department: e.department,
      status: e.status,
      quota:
        index < 3 && can(actor, "quota:view")
          ? (await getEmployeeQuota(e.id, year)).filter((l) => l.quotaRelevant).map((l) => ({ group: l.quotaGroupName, available: l.available }))
          : [],
    })),
  );

  return { employees: withQuota, articles, orders };
}
