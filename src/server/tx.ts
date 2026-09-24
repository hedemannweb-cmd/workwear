import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { translateDbError } from "./errors";

export type Tx = Prisma.TransactionClient;

/**
 * Führt einen Domänenprozess atomar aus. READ COMMITTED + explizite Zeilensperren
 * (siehe lockQuotaYears / Lager-Updates) statt SERIALIZABLE – Begründung in KONZEPT.md E.4.
 *
 * Sperrreihenfolge (Deadlock-Vermeidung), von allen Prozessen einzuhalten:
 *   1. QuotaYearLock (sortiert nach employeeId, year)
 *   2. Order
 *   3. Inventory (sortiert nach articleVariantId, inventoryLocationId) – siehe inventory/server/stock.ts
 */
export async function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 20_000 });
  } catch (e) {
    throw translateDbError(e);
  }
}

/**
 * Serialisiert alle kontingentwirksamen Vorgänge je Mitarbeiter und Jahr.
 * Eine zweite Transaktion wartet hier, bis die erste committed ist, und rechnet danach neu.
 */
export async function lockQuotaYears(tx: Tx, keys: Array<{ employeeId: string; year: number }>): Promise<void> {
  const unique = [...new Map(keys.map((k) => [`${k.employeeId}:${k.year}`, k])).values()].sort(
    (a, b) => a.employeeId.localeCompare(b.employeeId) || a.year - b.year,
  );
  for (const { employeeId, year } of unique) {
    await tx.$executeRaw`
      INSERT INTO "QuotaYearLock" ("employeeId", "year") VALUES (${employeeId}, ${year})
      ON CONFLICT DO NOTHING`;
    await tx.$queryRaw`
      SELECT 1 FROM "QuotaYearLock" WHERE "employeeId" = ${employeeId} AND "year" = ${year} FOR UPDATE`;
  }
}

export async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}
