import "server-only";
import { db } from "@/server/db";

export type CatalogVariant = {
  id: string;
  variantSku: string;
  size: string | null;
  sizeSort: number;
  color: string | null;
  /** frei verfügbar (physisch − reserviert) über alle Lagerorte vom Typ STORAGE */
  free: number;
  preferred: boolean;
};

export type CatalogArticle = { id: string; sku: string; name: string; variants: CatalogVariant[] };
export type CatalogGroup = { id: string; name: string; isQuotaRelevant: boolean; articles: CatalogArticle[] };

/**
 * Was kann an diesen Mitarbeiter ausgegeben/bestellt werden? Aktive Artikel je Kontingentgruppe,
 * Varianten mit frei verfügbarem Bestand; die Mitarbeitergröße ist als `preferred` markiert
 * (Kategorie-Überschreibung vor Skalen-Standard).
 */
export async function getIssueCatalog(employeeId: string): Promise<CatalogGroup[]> {
  const [groups, sizes, stock] = await Promise.all([
    db.quotaGroup.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        articles: {
          where: { active: true },
          orderBy: { name: "asc" },
          include: {
            category: { select: { id: true, sizeScaleId: true } },
            variants: { where: { active: true }, include: { size: true } },
          },
        },
      },
    }),
    db.employeeSize.findMany({ where: { employeeId } }),
    db.inventory.groupBy({
      by: ["articleVariantId"],
      where: { inventoryLocation: { type: "STORAGE", active: true } },
      _sum: { physicalQuantity: true, reservedQuantity: true },
    }),
  ]);

  const freeByVariant = new Map(stock.map((s) => [s.articleVariantId, (s._sum.physicalQuantity ?? 0) - (s._sum.reservedQuantity ?? 0)]));

  return groups
    .filter((g) => g.articles.length > 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      isQuotaRelevant: g.isQuotaRelevant,
      articles: g.articles.map((a) => {
        const own =
          sizes.find((s) => s.categoryId === a.category.id)?.sizeId ??
          sizes.find((s) => s.categoryId === null && s.sizeScaleId === a.category.sizeScaleId)?.sizeId;
        return {
          id: a.id,
          sku: a.sku,
          name: a.name,
          variants: a.variants
            .map((v) => ({
              id: v.id,
              variantSku: v.variantSku,
              size: v.size?.value ?? null,
              sizeSort: v.size?.sortOrder ?? 0,
              color: v.color,
              free: Math.max(0, freeByVariant.get(v.id) ?? 0),
              preferred: !!own && v.sizeId === own,
            }))
            .sort((x, y) => (x.color ?? "").localeCompare(y.color ?? "") || x.sizeSort - y.sizeSort),
        };
      }),
    }));
}
