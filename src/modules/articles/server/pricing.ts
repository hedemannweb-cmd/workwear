import "server-only";
import type { Tx } from "@/server/tx";
import type { db } from "@/server/db";

/**
 * Kostenbewertung einer Ausgabe (BDR-9, MVP): Einkaufspreis des Vorzugslieferanten zum Zeitpunkt
 * der Ausgabe. Der Wert wird an der Ausgabeposition festgeschrieben.
 * Fallback ohne Vorzugslieferant: niedrigster hinterlegter Preis; ohne Preis: null.
 */
export async function preferredUnitCosts(client: Tx | typeof db, articleIds: string[]): Promise<Map<string, string>> {
  if (articleIds.length === 0) return new Map();
  const rows = await client.articleSupplier.findMany({
    where: { articleId: { in: articleIds }, purchasePrice: { not: null }, supplier: { active: true } },
    select: { articleId: true, purchasePrice: true, isPreferred: true },
  });
  const result = new Map<string, string>();
  for (const articleId of articleIds) {
    const candidates = rows.filter((r) => r.articleId === articleId);
    const preferred = candidates.find((r) => r.isPreferred);
    const chosen =
      preferred ?? candidates.sort((a, b) => Number(a.purchasePrice) - Number(b.purchasePrice))[0];
    if (chosen?.purchasePrice) result.set(articleId, chosen.purchasePrice.toString());
  }
  return result;
}
